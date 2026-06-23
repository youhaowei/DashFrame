/**
 * DraftController — the persistent draft lifecycle.
 *
 * These tests pin the load-bearing contracts of the copy-on-write draft overlay
 * against a REAL artifact DB (PGlite), exercising the controller exactly as a
 * host would: open a draft, write through NORMAL command handlers (the same
 * `cmd(...)` vocabulary the UI and agent emit — proven isolated by routing
 * through `ctx.db` with a draftId in context), then publish or discard.
 *
 * Contracts under test:
 *   - Isolation      — a draft write is invisible in canonical until publish.
 *   - Persistence    — the draft survives a simulated process restart (close +
 *                      reopen the DB, rebuild app + controller from scratch).
 *   - Atomic publish — replaying the log lands all rows on canonical at once.
 *   - Discard        — drops the draft's deltas; canonical is untouched.
 *   - Sparse overlay — a draft over a large canonical set stores ONLY the
 *                      touched rows in `<table>__draft`, never a full copy.
 */
import {
  dataSourcesDraft,
  draftCommandLog,
  insightsDraft,
  openArtifactDb,
  schema,
} from "@dashframe/server-core";
import type { Command } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildDashframeApp,
  createDraftController,
  createFallThroughDraftDb,
} from "./app";
import { cmd } from "./functions/commands";

const { insights, dataSources, projectMeta } = schema;

describe("DraftController (persisted draft overlay)", () => {
  let dir: string;
  let dbPath: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: Awaited<ReturnType<typeof buildDashframeApp>>;
  let controller: ReturnType<typeof createDraftController>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-draft-"));
    dbPath = join(dir, "artifacts.db");
    ({ db, app, controller } = await openStack(dbPath));
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Open the full stack (db + app with the draft seam + controller) at a path. */
  async function openStack(path: string) {
    const openedDb = await openArtifactDb({ path });
    const builtApp = await buildDashframeApp({ db: openedDb });
    return {
      db: openedDb,
      app: builtApp,
      controller: createDraftController(builtApp, openedDb),
    };
  }

  function id(): string {
    return crypto.randomUUID();
  }

  /** Append a batch to a draft via the controller's normal applyCommands seam. */
  async function appendCmds(draftId: string, ...commands: Command[]) {
    return controller.appendToDraft(draftId, commands);
  }

  /** Seed a DataSource + DataTable on CANONICAL (the draft's base). */
  async function seedTable(
    target: ReturnType<typeof createDraftController>,
  ): Promise<{ sourceId: string; tableId: string }> {
    const sourceId = id();
    const tableId = id();
    // Publish a tiny draft to land the base rows on canonical without a separate
    // canonical-write path — keeps the test using only the controller's surface.
    const seed = await target.openDraft();
    await target.appendToDraft(seed, [
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "T",
        table: "t.csv",
      }),
    ]);
    await target.publishDraft(seed);
    return { sourceId, tableId };
  }

  async function canonicalInsights() {
    return db.select().from(insights);
  }
  async function draftInsightRows(draftId: string) {
    const rows = await db.select().from(insightsDraft);
    return rows.filter((r) => r.draftId === draftId);
  }
  async function draftDataSourceRows(draftId: string) {
    const rows = await db.select().from(dataSourcesDraft);
    return rows.filter((r) => r.draftId === draftId);
  }

  it("isolates a draft write — invisible in canonical until publish", async () => {
    const { tableId } = await seedTable(controller);
    const insightId = id();

    const draftId = await controller.openDraft();
    await appendCmds(
      draftId,
      cmd("CreateInsight", {
        id: insightId,
        name: "Draft insight",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );

    // Canonical does NOT see the draft insight.
    const canonical = await canonicalInsights();
    expect(canonical.find((r) => r.id === insightId)).toBeUndefined();

    // The draft overlay DOES hold it (the shadow row exists, scoped to draftId).
    const shadow = await draftInsightRows(draftId);
    expect(shadow).toHaveLength(1);
    expect(shadow[0]?.id).toBe(insightId);
    expect(shadow[0]?.name).toBe("Draft insight");
  });

  it("survives a simulated reload — the draftId is the durable handle", async () => {
    const { tableId } = await seedTable(controller);
    const insightId = id();

    const draftId = await controller.openDraft();
    await appendCmds(
      draftId,
      cmd("CreateInsight", {
        id: insightId,
        name: "Persisted insight",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );

    // Simulate a process restart: close the DB, drop the in-memory app +
    // controller (and wystack's ephemeral lifecycle Map with them), reopen the
    // SAME file, rebuild the stack from scratch.
    await db.$client.close();
    ({ db, controller } = await openStack(dbPath));

    // The persisted command log survived — the reopened controller reads it.
    const log = await controller.getDraftLog(draftId);
    expect(log).toHaveLength(1);
    expect(log[0]?.path).toBeTruthy();

    // The shadow row survived too — still isolated from canonical.
    expect(
      (await canonicalInsights()).find((r) => r.id === insightId),
    ).toBeUndefined();
    expect(await draftInsightRows(draftId)).toHaveLength(1);

    // Publishing the REHYDRATED draft (cold path) lands it on canonical.
    await controller.publishDraft(draftId);
    expect(
      (await canonicalInsights()).find((r) => r.id === insightId)?.name,
    ).toBe("Persisted insight");
  });

  it("publishes atomically — the whole log lands on canonical, then the draft is gone", async () => {
    const { tableId } = await seedTable(controller);
    const insightA = id();
    const insightB = id();

    const draftId = await controller.openDraft();
    await appendCmds(
      draftId,
      cmd("CreateInsight", {
        id: insightA,
        name: "A",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );
    await appendCmds(
      draftId,
      cmd("CreateInsight", {
        id: insightB,
        name: "B",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );

    const result = await controller.publishDraft(draftId);

    // Both insights landed on canonical.
    const canonical = await canonicalInsights();
    expect(canonical.find((r) => r.id === insightA)?.name).toBe("A");
    expect(canonical.find((r) => r.id === insightB)?.name).toBe("B");
    // The publish reported the canonical table it wrote (host flushes this to
    // invalidation). `insights` is the canonical name, not the shadow.
    expect(result.tablesWritten.has("insights")).toBe(true);

    // The draft is fully torn down: no shadow rows, no command-log rows.
    expect(await draftInsightRows(draftId)).toHaveLength(0);
    const logRows = (await db.select().from(draftCommandLog)).filter(
      (r) => r.draftId === draftId,
    );
    expect(logRows).toHaveLength(0);
  });

  it("discards a draft — canonical is left untouched", async () => {
    const { tableId } = await seedTable(controller);
    const before = await canonicalInsights();

    const draftId = await controller.openDraft();
    // Touch TWO distinct shadow tables (data_sources__draft + insights__draft) so
    // the sweep is proven across more than one entry of the closed set — a sweep
    // bug on any single shadow table would otherwise hide behind insights-only.
    await appendCmds(
      draftId,
      cmd("CreateDataSource", { id: id(), type: "csv", name: "Throwaway src" }),
      cmd("CreateInsight", {
        id: id(),
        name: "Throwaway",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );
    // The draft holds a row in BOTH shadow tables before discard.
    expect(await draftInsightRows(draftId)).toHaveLength(1);
    expect(await draftDataSourceRows(draftId)).toHaveLength(1);

    await controller.discardDraft(draftId);

    // Canonical insights are byte-identical to before the draft existed.
    const after = await canonicalInsights();
    expect(after).toHaveLength(before.length);
    // The draft's deltas are gone across BOTH shadow tables AND the command log.
    expect(await draftInsightRows(draftId)).toHaveLength(0);
    expect(await draftDataSourceRows(draftId)).toHaveLength(0);
    const logRows = (await db.select().from(draftCommandLog)).filter(
      (r) => r.draftId === draftId,
    );
    expect(logRows).toHaveLength(0);
  });

  it("does NOT draft when no draftId is in context — the seam writes straight to canonical", async () => {
    // The negative half of the seam contract: withDraftSeam must return the base
    // tracked handle untouched when context has no draftId, so an ordinary RPC
    // (`app.call` with an empty context) lands on CANONICAL, never a shadow. A
    // regression in draftIdFromContext that minted a spurious id would silently
    // redirect canonical writes into a dangling shadow — this catches that.
    const sourceId = id();
    const create = cmd("CreateDataSource", {
      id: sourceId,
      type: "csv",
      name: "Direct",
    });
    await app.call(create.path, create.args, {});

    // Landed on canonical.
    const canonical = await db.select().from(dataSources);
    expect(canonical.find((r) => r.id === sourceId)).toBeDefined();
    // No shadow row exists for ANY draft (the no-draft path never touches a shadow).
    expect(await db.select().from(dataSourcesDraft)).toHaveLength(0);
  });

  it("re-seqs the durable log across appends — replace-all, never append-only-duplicate (writeLog bookkeeping)", async () => {
    // The controller's load-bearing novelty over wystack's in-memory lifecycle is
    // that `draft_command_log` is a MATERIALIZED projection: each append re-runs
    // compactLog over the full history and REPLACE-ALLs the draftId's rows with a
    // dense 0..n re-seq. This pins that bookkeeping — a second append must not
    // leave the first batch's rows orphaned (append-only) or duplicated; the log
    // must equal the full ordered history exactly once.
    const { tableId } = await seedTable(controller);
    const draftId = await controller.openDraft();

    await appendCmds(
      draftId,
      cmd("CreateInsight", {
        id: id(),
        name: "First",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );
    await appendCmds(
      draftId,
      cmd("CreateInsight", {
        id: id(),
        name: "Second",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );

    // The persisted log holds exactly the two commands, in order — not 1 (lost),
    // not 3+ (the first batch re-inserted alongside a stale copy).
    const log = await controller.getDraftLog(draftId);
    expect(log).toHaveLength(2);
    expect(log.map((c) => c.path)).toEqual([
      cmd("CreateInsight", {
        id: id(),
        name: "x",
        source: { sourceType: "dataTable", sourceId: tableId },
      }).path,
      cmd("CreateInsight", {
        id: id(),
        name: "y",
        source: { sourceType: "dataTable", sourceId: tableId },
      }).path,
    ]);

    // The raw rows carry a dense 0..n seq (the unique (draft_id, seq) index is
    // satisfied only if the re-seq is dense and the replace-all ran).
    const rows = (await db.select().from(draftCommandLog))
      .filter((r) => r.draftId === draftId)
      .sort((a, b) => a.seq - b.seq);
    expect(rows.map((r) => r.seq)).toEqual([0, 1]);
  });

  it("coalesces a jsonb column + PK-pinned read INSIDE a draft — a draft-only row is read back through the seam (gap-1 + gap-2)", async () => {
    // This is the regression that bb9b745 fixed end-to-end through the controller:
    //   gap-1 — the draft write-path bypassed the jsonb codec, so a jsonb column
    //           (insights.definition) did not round-trip through <table>__draft.
    //   gap-2 — a PK-pinned draft read (`from(t).where(eq("id",x)).first()`) did
    //           not pin the draft row, so a handler reading a draft-only artifact
    //           by id saw nothing.
    // SetInsightSource exercises BOTH at once: it does a PK-pinned read of the
    // insight's jsonb `definition` (requireInsightDefinition → from(insights)
    // .where(eq("id",id)).first()), mutates it, and writes the jsonb back —
    // entirely on a row that exists ONLY in the draft shadow. If either fix
    // were absent the handler would throw "Insight not found" (gap-2) or write a
    // corrupt/empty definition (gap-1).
    const { tableId } = await seedTable(controller);
    // A second canonical DataTable to re-point the source to.
    const sourceId2 = id();
    const tableId2 = id();
    const seed2 = await controller.openDraft();
    await controller.appendToDraft(seed2, [
      cmd("CreateDataSource", { id: sourceId2, type: "csv", name: "S2" }),
      cmd("CreateDataTable", {
        id: tableId2,
        dataSourceId: sourceId2,
        name: "T2",
        table: "t2.csv",
      }),
    ]);
    await controller.publishDraft(seed2);

    const insightId = id();
    const draftId = await controller.openDraft();
    // Create the insight INSIDE the draft (so it lives only in the shadow), with
    // its jsonb `definition.source` pointed at table 1.
    await appendCmds(
      draftId,
      cmd("CreateInsight", {
        id: insightId,
        name: "Composed",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );

    // Re-point the source in a SEPARATE batch. SetInsightSource must PK-read the
    // draft-only insight's jsonb definition (gap-2 + gap-1 read) before writing.
    // A broken primitive throws here.
    await appendCmds(
      draftId,
      cmd("SetInsightSource", {
        id: insightId,
        source: { sourceType: "dataTable", sourceId: tableId2 },
      }),
    );

    // The shadow row's jsonb `definition` coalesced and round-tripped: the
    // re-point landed, proving the jsonb codec ran on the draft write-path.
    const shadow = await draftInsightRows(draftId);
    expect(shadow).toHaveLength(1);
    const def = shadow[0]?.definition as {
      source?: { sourceId?: string };
      baseTableId?: string;
    };
    expect(def?.source?.sourceId).toBe(tableId2);
    expect(def?.baseTableId).toBe(tableId2);
    // Canonical never saw the draft-only insight.
    expect(
      (await canonicalInsights()).find((r) => r.id === insightId),
    ).toBeUndefined();

    // Publishing replays the (compacted) log onto canonical; the final jsonb
    // definition lands intact (end-to-end through the publish path too).
    await controller.publishDraft(draftId);
    const published = (await canonicalInsights()).find(
      (r) => r.id === insightId,
    );
    const pubDef = published?.definition as { source?: { sourceId?: string } };
    expect(pubDef?.source?.sourceId).toBe(tableId2);
  });

  it("cold-publishes from the durable log alone — a fresh stack with no in-memory state lands identically", async () => {
    // The warm publish (other tests) replays the same in-process append state.
    // This pins the COLD path: the appending process is gone; publish reads the
    // log fresh off disk and replays. The brief's load-bearing claim — publish
    // never forks on whether the opening process is alive — lives here.
    const { tableId } = await seedTable(controller);
    const insightId = id();

    const draftId = await controller.openDraft();
    await appendCmds(
      draftId,
      cmd("CreateInsight", {
        id: insightId,
        name: "Cold",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );

    // Drop ALL in-memory state: close the db, rebuild the stack from the file.
    await db.$client.close();
    ({ db, controller } = await openStack(dbPath));

    // Publish reads the log fresh (no append happened in THIS process) and replays.
    const result = await controller.publishDraft(draftId);
    expect(result.tablesWritten.has("insights")).toBe(true);

    // Canonical has the row; shadow + log are swept — identical to a warm publish.
    expect(
      (await canonicalInsights()).find((r) => r.id === insightId)?.name,
    ).toBe("Cold");
    expect(await draftInsightRows(draftId)).toHaveLength(0);
    const logRows = (await db.select().from(draftCommandLog)).filter(
      (r) => r.draftId === draftId,
    );
    expect(logRows).toHaveLength(0);
  });

  it("publishes to CANONICAL even when a draftId leaks into the publish context — the replay is never re-drafted", async () => {
    // applyCommands dispatches the replay through the (wrapped) runHandler, which
    // re-applies withDraftSeam from the publish context. If a consumer forwards a
    // request context that still carries `draftId`, an un-stripped publish would
    // re-scope the replay into <table>__draft and then dropDraft would sweep it —
    // the publish would silently land nothing on canonical. publishDraft must
    // strip draftId so the replay is unambiguously canonical.
    const { tableId } = await seedTable(controller);
    const insightId = id();

    const draftId = await controller.openDraft();
    await appendCmds(
      draftId,
      cmd("CreateInsight", {
        id: insightId,
        name: "Leaky-ctx",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );

    // Publish with a HOSTILE context that echoes the same draftId (simulating a
    // consumer that forwards the request context verbatim).
    await controller.publishDraft(draftId, { draftId });

    // The row landed on CANONICAL — not lost into the shadow.
    expect(
      (await canonicalInsights()).find((r) => r.id === insightId)?.name,
    ).toBe("Leaky-ctx");
    // And the draft is fully torn down (publish succeeded, not a phantom).
    expect(await draftInsightRows(draftId)).toHaveLength(0);
  });

  it("is a SPARSE overlay — a draft over many canonical rows stores only touched rows", async () => {
    // Seed a "large" canonical set: 10 insights on canonical.
    const { tableId } = await seedTable(controller);
    const seededIds: string[] = [];
    const seed = await controller.openDraft();
    const seedCmds: Command[] = [];
    for (let i = 0; i < 10; i++) {
      const iid = id();
      seededIds.push(iid);
      seedCmds.push(
        cmd("CreateInsight", {
          id: iid,
          name: `Insight ${i}`,
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );
    }
    await controller.appendToDraft(seed, seedCmds);
    await controller.publishDraft(seed);
    expect(await canonicalInsights()).toHaveLength(10);

    // Open a draft and touch exactly ONE of the 10 canonical insights.
    const draftId = await controller.openDraft();
    await appendCmds(
      draftId,
      cmd("RenameNode", {
        id: seededIds[0]!,
        name: "Touched",
      }),
    );

    // The shadow holds ONLY the one touched row — NOT a full copy of all 10.
    const shadow = await draftInsightRows(draftId);
    expect(shadow).toHaveLength(1);
    expect(shadow[0]?.id).toBe(seededIds[0]);

    // The other 9 canonical insights have no shadow row for this draft.
    const allShadow = await db.select().from(insightsDraft);
    expect(allShadow.filter((r) => r.draftId === draftId)).toHaveLength(1);
  });

  it("reads a NON-DRAFTABLE table (project_meta) inside a draft — falls through to canonical, no missing-shadow throw", async () => {
    // project_meta has NO `__draft` shadow by the credential-security-boundary
    // design. A handler reading it inside a draftId context must coalesce-read
    // NOTHING and fall through to canonical — NOT fail on a missing
    // `project_meta__draft` relation. The fall-through draft handle (what the
    // seam yields when a draftId is present) routes non-draftable tables to the
    // base canonical handle.
    const draftId = await controller.openDraft();
    const draftDb = createFallThroughDraftDb(app.createTracked(), draftId);

    // Seed a canonical project_meta row (openArtifactDb materializes the table
    // but openProject is what normally seeds the row). Reading it through the
    // draft handle must return THIS canonical row, not throw on a missing
    // `project_meta__draft` relation.
    const metaId = id();
    await db.insert(projectMeta).values({
      id: metaId,
      version: "0.2.0",
      projectId: id(),
      name: "Test project",
      schemaVersion: 3,
      createdBy: "test",
    });
    const canonicalRow = (await db.select().from(projectMeta))[0];
    expect(canonicalRow).toBeDefined();

    let row: unknown;
    await expect(
      (async () => {
        row = await draftDb.from(projectMeta).first();
      })(),
    ).resolves.toBeUndefined(); // i.e. did not throw
    expect((row as { id?: unknown })?.id).toBe(metaId);

    // And a DRAFTABLE table still routes to the overlay (sanity: the wrapper is
    // not just delegating everything to canonical). A draft insert lands in the
    // shadow, invisible to canonical.
    const insightId = id();
    const { tableId } = await seedTable(controller);
    await appendCmds(
      draftId,
      cmd("CreateInsight", {
        id: insightId,
        name: "Drafted",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );
    expect(
      (await db.select().from(insights)).find((r) => r.id === insightId),
    ).toBeUndefined();
    expect(
      (await db.select().from(insightsDraft)).filter(
        (r) => r.draftId === draftId,
      ),
    ).toHaveLength(1);
  });

  it("round-trips the command correlation id through the durable log — warm AND cold publish echo it", async () => {
    // Command.id is the opaque correlation handle a consumer uses to match a
    // CommitResult back to the command that produced it. The persisted log must
    // carry it so publish (which replays the REHYDRATED log, even without a
    // restart) echoes the same id — not undefined.
    const { tableId } = await seedTable(controller);
    const insightId = id();
    const correlationId = `corr-${id()}`;

    const draftId = await controller.openDraft();
    // A command carrying an explicit correlation id.
    const create: Command = {
      id: correlationId,
      ...cmd("CreateInsight", {
        id: insightId,
        name: "Correlated",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    };
    await controller.appendToDraft(draftId, [create]);

    // The persisted log preserved the correlation id.
    const log = await controller.getDraftLog(draftId);
    expect(log).toHaveLength(1);
    expect(log[0]?.id).toBe(correlationId);

    // Warm publish (same process) replays the rehydrated log; its result echoes
    // the correlation id, not undefined.
    const result = await controller.publishDraft(draftId);
    expect(result.results.map((r) => r.id)).toContain(correlationId);
  });

  it("preserves the command id across a cold publish — rehydrated from the durable log alone", async () => {
    const { tableId } = await seedTable(controller);
    const insightId = id();
    const correlationId = `corr-${id()}`;

    const draftId = await controller.openDraft();
    await controller.appendToDraft(draftId, [
      {
        id: correlationId,
        ...cmd("CreateInsight", {
          id: insightId,
          name: "Cold-correlated",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      },
    ]);

    // Drop in-memory state: close + rebuild the stack from the file.
    await db.$client.close();
    ({ db, app, controller } = await openStack(dbPath));

    // The cold publish reads the log fresh; the correlation id survives because
    // it was persisted alongside path/args.
    const result = await controller.publishDraft(draftId);
    expect(result.results.map((r) => r.id)).toContain(correlationId);
  });

  it("snapshots each command before persisting — a caller mutating args after append does not corrupt the durable log", async () => {
    // appendToDraft runs the handler against the live command, then persists a
    // DEEP COPY of what ran. If the caller mutates the command/args afterward,
    // the durable log must still replay the command as it actually executed.
    const { tableId } = await seedTable(controller);
    const insightId = id();

    const draftId = await controller.openDraft();
    const mutable = cmd("CreateInsight", {
      id: insightId,
      name: "Original",
      source: { sourceType: "dataTable", sourceId: tableId },
    });
    await controller.appendToDraft(draftId, [mutable]);

    // Mutate the command's args AFTER the append returned (simulating a caller
    // reusing/mutating the object). The persisted log must be unaffected.
    (mutable.args as { name: string }).name = "Mutated-after-append";

    const log = await controller.getDraftLog(draftId);
    expect((log[0]?.args as { name?: string })?.name).toBe("Original");

    // And the published canonical row reflects what RAN, not the later mutation.
    await controller.publishDraft(draftId);
    expect(
      (await db.select().from(insights)).find((r) => r.id === insightId)?.name,
    ).toBe("Original");
  });
});
