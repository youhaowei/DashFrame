/**
 * Draft lifecycle RPCs — publishDraft, discardDraft, getDraftLog
 *
 * Pins the two contracts the QA review identified as untested but load-bearing:
 *
 *   1. `publishDraft` fires `onWrite` after a successful publish. The outer
 *      `buildDashframeApp` tracker sees zero writes (sub-tracker asymmetry from
 *      the `applyCommands(mode:'commit')` inside the controller), so the handler
 *      must fire `ctx.onWrite` explicitly. If this regresses, snapshots stop
 *      persisting after publish → data loss on crash.
 *
 *   2. `discardDraft` fires `onWrite` after a successful discard. The handler
 *      deletes rows the outer tracker never sees; missing this leaves a
 *      resurrection window across server restarts → phantom draft rows.
 *
 *   3. The `__extraTablesWritten` relay in `app.ts` strips the sentinel field
 *      from the HTTP response while broadcasting the WS invalidation set.
 *      If the strip is lost, clients see an internal implementation detail;
 *      if the merge is lost, WS subscriptions don't refresh after publish.
 *
 * Setup: open a real PGlite project, seed a draft via an external controller
 * backed by the same DB (the same design `draft-controller.test.ts` uses), then
 * exercise publishDraft/discardDraft/getDraftLog via the HTTP server.
 *
 * WHY external controller for seeding: `openDraft` and `appendToDraft` are
 * internal DraftController methods, not RPC endpoints. The seam these tests own
 * is the HTTP RPC path from the renderer to the server (contracts 1–3 above).
 * Controller unit contracts live in draft-controller.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openProject,
  schema,
  type ArtifactDb,
  type ProjectHandle,
} from "@dashframe/server-core";
import {
  createApi,
  createClient,
  type ApiFromFunctions,
} from "@wystack/client";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
  type SecretRef,
} from "@wystack/secret-vault";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildDashframeApp,
  createDashframeServer,
  createDraftController,
  type DashframeServer,
} from "../app";
import { captureCommandCredentials } from "../credential-release";
import type { Functions } from "../functions";
import { LOCAL_USER_ID } from "../permissions";
import { cmd } from "./commands";

/** Mirrors packages/app/src/wystack/api.ts's module-scope api object. */
const api: ApiFromFunctions<Functions> = createApi<Functions>();
const USER_TOKEN = "renderer-token";

const { dataSources } = schema;

function makeTestVault(): SecretVault {
  const backend = new TestBackend();
  const registry = new SecretRegistry();
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault("connector-key", "test");
  return new SecretVault(registry, new InMemoryMappingStore());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(url: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${url}/api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${USER_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

/** GET /api/:path?args=<json> — for WyStack query endpoints. */
function get(url: string, path: string, args: unknown): Promise<Response> {
  const params = new URLSearchParams({ args: JSON.stringify(args) });
  return fetch(`${url}/api/${path}?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${USER_TOKEN}` },
  });
}

async function buildUserApp(opts: Parameters<typeof buildDashframeApp>[0]) {
  const baseApp = await buildDashframeApp(opts);
  return {
    ...baseApp,
    call: (path, args, context) =>
      baseApp.call(path, args, {
        ...(context ?? {}),
        principal: { kind: "user", userId: LOCAL_USER_ID },
      }),
    runHandler: (path, args, tracked, context) =>
      baseApp.runHandler(path, args, tracked, {
        ...(context ?? {}),
        principal: { kind: "user", userId: LOCAL_USER_ID },
      }),
  } satisfies typeof baseApp;
}

function createUserServer(opts: Parameters<typeof createDashframeServer>[0]) {
  return createDashframeServer({ ...opts, authToken: USER_TOKEN });
}

async function postOk<T>(url: string, path: string, body: unknown): Promise<T> {
  const res = await post(url, path, body);
  expect(res.status, `POST ${path} returned ${res.status}`).toBe(200);
  const json = (await res.json()) as { data: T };
  return json.data;
}

async function getOk<T>(url: string, path: string, args: unknown): Promise<T> {
  const res = await get(url, path, args);
  expect(res.status, `GET ${path} returned ${res.status}`).toBe(200);
  const json = (await res.json()) as { data: T };
  return json.data;
}

/** Wall-clock pause so a subsequent canonical write's `updated_at` clears the draft's `baseVersion`. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe("draft lifecycle RPCs (publishDraft, discardDraft, getDraftLog)", () => {
  let root: string;
  let project: ProjectHandle | null;
  let server: DashframeServer | null;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dashframe-draft-rpc-"));
    project = null;
    server = null;
  });

  afterEach(async () => {
    server?.stop();
    await project?.close();
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Seed a draft via an external controller backed by the same DB that
   * `createDashframeServer` will use. Since the draft log lives in the DB,
   * the server's internal controller can read and replay it.
   *
   * Returns the draftId to pass to the HTTP RPCs.
   */
  async function seedDraft(db: ArtifactDb): Promise<string> {
    const seedApp = await buildUserApp({ db });
    const seedController = createDraftController(seedApp, db);

    // Seed a DataSource into canonical first (publishDraft writes to the
    // canonical data_sources table — we need it to exist for the next draft
    // to reference the right foreign-key chain).
    const sourceId = crypto.randomUUID();
    const baseDraft = await seedController.openDraft();
    await seedController.appendToDraft(baseDraft, [
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "Base" }),
    ]);
    await seedController.publishDraft(baseDraft);

    // Now open the draft that the RPC tests will publish or discard.
    const draftId = await seedController.openDraft();
    await seedController.appendToDraft(draftId, [
      cmd("CreateDataSource", {
        id: crypto.randomUUID(),
        type: "csv",
        name: "Draft source",
      }),
    ]);

    return draftId;
  }

  async function seedCanonicalSource(db: ArtifactDb, name: string) {
    const seedApp = await buildUserApp({ db });
    const seedController = createDraftController(seedApp, db);
    const sourceId = crypto.randomUUID();
    const seedDraftId = await seedController.openDraft();
    await seedController.appendToDraft(seedDraftId, [
      cmd("CreateDataSource", { id: sourceId, type: "csv", name }),
    ]);
    await seedController.publishDraft(seedDraftId);
    return { sourceId, seedController };
  }

  // -------------------------------------------------------------------------
  // Contract 1: publishDraft fires onWrite
  // -------------------------------------------------------------------------

  it("publishDraft fires onWrite when tables are written", async () => {
    const onWriteCalls: number[] = [];

    project = await openProject({ dir: join(root, "proj") });
    const draftId = await seedDraft(project.db as ArtifactDb);

    server = await createUserServer({
      db: project.db,
      onWrite: () => onWriteCalls.push(Date.now()),
    });

    const result = await postOk<{ tablesWritten: string[] }>(
      server.url,
      "publishDraft",
      { draftId },
    );

    // Contract: onWrite fires once after the publish commits.
    // If it fires zero times, snapshot persistence regresses on publish.
    expect(onWriteCalls).toHaveLength(1);

    // tablesWritten is non-empty — the log had one CreateDataSource command.
    expect(result.tablesWritten.length).toBeGreaterThan(0);
  });

  it("publishDraft does NOT fire onWrite when the draft log is empty", async () => {
    const onWriteCalls: number[] = [];

    project = await openProject({ dir: join(root, "empty") });

    // Open a draft with no commands — no writes means no onWrite.
    const seedApp = await buildUserApp({ db: project.db as ArtifactDb });
    const seedController = createDraftController(
      seedApp,
      project.db as ArtifactDb,
    );
    const emptyDraftId = await seedController.openDraft();

    server = await createUserServer({
      db: project.db,
      onWrite: () => onWriteCalls.push(Date.now()),
    });

    const result = await postOk<{ tablesWritten: string[] }>(
      server.url,
      "publishDraft",
      { draftId: emptyDraftId },
    );

    // Empty log → no tables written → onWrite must NOT fire.
    expect(onWriteCalls).toHaveLength(0);
    expect(result.tablesWritten).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Contract 2: discardDraft fires onWrite
  // -------------------------------------------------------------------------

  it("discardDraft fires onWrite after successfully discarding", async () => {
    const onWriteCalls: number[] = [];

    project = await openProject({ dir: join(root, "proj") });
    const draftId = await seedDraft(project.db as ArtifactDb);

    server = await createUserServer({
      db: project.db,
      onWrite: () => onWriteCalls.push(Date.now()),
    });

    await postOk<void>(server.url, "discardDraft", { draftId });

    // Contract: discard deletes shadow rows + log; onWrite must fire so the
    // snapshot is flushed, closing the resurrection-on-restart window.
    expect(onWriteCalls).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Contract 3: __extraTablesWritten relay — strip from response
  // -------------------------------------------------------------------------

  it("publishDraft response does NOT expose __extraTablesWritten", async () => {
    project = await openProject({ dir: join(root, "proj") });
    const draftId = await seedDraft(project.db as ArtifactDb);

    server = await createUserServer({ db: project.db });

    const res = await post(server.url, "publishDraft", { draftId });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: Record<string, unknown> };

    // The `__extraTablesWritten` sentinel is an internal relay field.
    // If the `app.ts` relay strip breaks, this assertion catches it so clients
    // don't see implementation detail leaking into the API response.
    expect(body.data).not.toHaveProperty("__extraTablesWritten");
    // The public field is still present.
    expect(body.data).toHaveProperty("tablesWritten");
  });

  it("publishDraft blocks a stale draft when canonical changed the same touched cell and surfaces the conflict report", async () => {
    project = await openProject({ dir: join(root, "conflict") });
    const db = project.db as ArtifactDb;
    const { sourceId, seedController } = await seedCanonicalSource(db, "Base");

    const draftId = await seedController.openDraft();
    await seedController.appendToDraft(draftId, [
      cmd("RenameNode", { id: sourceId, name: "Draft rename" }),
    ]);

    // Separate the draft's baseVersion from the canonical write by ~5ms of real
    // elapsed time. Both timestamps are independent `new Date()` reads, not
    // coalesced DB writes — CI contention only widens the gap. An explicit
    // past baseVersion would pull seed writes into the stale window and break
    // the disjoint-cell test below.
    await delay(5);
    await db
      .update(dataSources)
      .set({ name: "Canonical rename" })
      .where(eq(dataSources.id, sourceId));

    server = await createUserServer({ db });

    const res = await post(server.url, "publishDraft", { draftId });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      issues: Array<{
        params?: {
          kind?: string;
          conflictReport?: {
            staleBase: boolean;
            overlappingCells: Array<{ table: string; id: string }>;
          };
        };
      }>;
    };

    expect(body.error).toContain("draft conflicts with canonical changes");
    const report = body.issues[0]?.params?.conflictReport;
    expect(body.issues[0]?.params?.kind).toBe("draft_conflict");
    expect(report).toEqual({
      staleBase: true,
      overlappingCells: [{ table: "data_sources", id: sourceId }],
    });

    expect(await seedController.getDraftLog(draftId)).toHaveLength(1);
    const rows = await db.select().from(dataSources);
    expect(rows.find((row) => row.id === sourceId)?.name).toBe(
      "Canonical rename",
    );
  });

  it("publishDraft still succeeds when canonical changed a disjoint cell after the draft opened", async () => {
    project = await openProject({ dir: join(root, "disjoint") });
    const db = project.db as ArtifactDb;
    const { sourceId: draftSourceId, seedController } =
      await seedCanonicalSource(db, "Draft target");
    const { sourceId: canonicalSourceId } = await seedCanonicalSource(
      db,
      "Canonical target",
    );

    const draftId = await seedController.openDraft();
    await seedController.appendToDraft(draftId, [
      cmd("RenameNode", { id: draftSourceId, name: "Draft rename" }),
    ]);

    // Same ordering guarantee as the overlapping-cell conflict test above.
    await delay(5);
    await db
      .update(dataSources)
      .set({ name: "Disjoint canonical rename" })
      .where(eq(dataSources.id, canonicalSourceId));

    server = await createUserServer({ db });

    await postOk<{ tablesWritten: string[] }>(server.url, "publishDraft", {
      draftId,
    });

    const rows = await db.select().from(dataSources);
    expect(rows.find((row) => row.id === draftSourceId)?.name).toBe(
      "Draft rename",
    );
    expect(rows.find((row) => row.id === canonicalSourceId)?.name).toBe(
      "Disjoint canonical rename",
    );
    expect(await seedController.getDraftLog(draftId)).toHaveLength(0);
  });

  it("publishDraft blocks when canonical DELETED a row the draft touched and surfaces the conflict report", async () => {
    project = await openProject({ dir: join(root, "delete-conflict") });
    const db = project.db as ArtifactDb;
    const { sourceId, seedController } = await seedCanonicalSource(db, "Base");

    const draftId = await seedController.openDraft();
    await seedController.appendToDraft(draftId, [
      cmd("RenameNode", { id: sourceId, name: "Draft rename" }),
    ]);

    // Another session deletes the row the draft is editing. A delete bumps no
    // surviving row's timestamp, so this is caught only against the base
    // inventory — no `delay()` needed (the row's absence, not its timestamp, is
    // the signal).
    await db.delete(dataSources).where(eq(dataSources.id, sourceId));

    server = await createUserServer({ db });

    const res = await post(server.url, "publishDraft", { draftId });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      issues: Array<{
        params?: {
          kind?: string;
          conflictReport?: {
            staleBase: boolean;
            overlappingCells: Array<{ table: string; id: string }>;
          };
        };
      }>;
    };

    expect(body.issues[0]?.params?.kind).toBe("draft_conflict");
    expect(body.issues[0]?.params?.conflictReport).toEqual({
      staleBase: true,
      overlappingCells: [{ table: "data_sources", id: sourceId }],
    });
    // The blocked publish leaves the draft intact for a rebase/repair.
    expect(await seedController.getDraftLog(draftId)).toHaveLength(1);
  });

  it("publishDraft still succeeds when canonical DELETED a row the draft did not touch", async () => {
    project = await openProject({ dir: join(root, "delete-disjoint") });
    const db = project.db as ArtifactDb;
    const { sourceId: draftSourceId, seedController } =
      await seedCanonicalSource(db, "Draft target");
    const { sourceId: deletedSourceId } = await seedCanonicalSource(
      db,
      "Deleted elsewhere",
    );

    const draftId = await seedController.openDraft();
    await seedController.appendToDraft(draftId, [
      cmd("RenameNode", { id: draftSourceId, name: "Draft rename" }),
    ]);

    // Canonical deletes a DIFFERENT source than the draft touches — disjoint,
    // so the publish must proceed.
    await db.delete(dataSources).where(eq(dataSources.id, deletedSourceId));

    server = await createUserServer({ db });

    await postOk<{ tablesWritten: string[] }>(server.url, "publishDraft", {
      draftId,
    });

    const rows = await db.select().from(dataSources);
    expect(rows.find((row) => row.id === draftSourceId)?.name).toBe(
      "Draft rename",
    );
    expect(rows.some((row) => row.id === deletedSourceId)).toBe(false);
    expect(await seedController.getDraftLog(draftId)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // TOCTOU guard: expectedCommandCount
  // -------------------------------------------------------------------------

  it("publishDraft rejects when expectedCommandCount does not match the log", async () => {
    project = await openProject({ dir: join(root, "proj") });
    const draftId = await seedDraft(project.db as ArtifactDb);

    server = await createUserServer({ db: project.db });

    const res = await post(server.url, "publishDraft", {
      draftId,
      expectedCommandCount: "99",
    });
    expect(res.status).toBe(500);

    const log = await getOk<{ path: string }[]>(server.url, "getDraftLog", {
      draftId,
    });
    expect(log.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // RPC-boundary regression guard: the real @wystack/client must surface the
  // server's drift message, not a generic `HTTP 500`.
  //
  // `@wystack/client`'s own test suite (packages/client/src/__tests__/
  // client.test.ts) already proves the client forwards an arbitrary server
  // error message against a synthetic handler; what that suite cannot prove
  // is that DashFrame's ACTUAL drift error — the string draft-controller.ts
  // throws — survives the round trip through DashFrame's real server. Before
  // the client fix, it discarded the response body and threw a bare
  // `Error("HTTP 500")`, so `draftLifecycleErrorDescription` (packages/app/
  // src/components/preview-diff/user-facing-errors.ts) could never match
  // `.includes("changed since review")` — the drift-specific toast copy was
  // dead code. The other half of that contract (message → user-facing copy)
  // is pinned by user-facing-errors.test.ts in packages/app; the two tests
  // share the "changed since review" substring as their join point instead of
  // a single cross-package test, since apps/server does not (and should not)
  // depend on the packages/app UI layer.
  // -------------------------------------------------------------------------

  it("publishDraft's drift rejection survives the real @wystack/client RPC boundary with the drift message intact", async () => {
    project = await openProject({ dir: join(root, "proj") });
    const draftId = await seedDraft(project.db as ArtifactDb);

    server = await createUserServer({ db: project.db });

    const client = createClient({
      url: server.url,
      getToken: async () => USER_TOKEN,
    });

    let caught: Error | undefined;
    try {
      await client.mutate(
        api.publishDraft,
        // Keep this direct generic test call explicitly cast so the assertion
        // remains focused on HTTP error propagation.
        {
          draftId,
          // A count that can never match the seeded log's length forces the
          // same drift branch `draft-controller.ts` uses for real content
          // drift, without needing a second controller to race the log.
          expectedCommandCount: "99",
        } as unknown as Parameters<
          typeof client.mutate<typeof api.publishDraft>
        >[1],
      );
    } catch (err) {
      caught = err as Error;
    }

    // Pre-bump, this was `Error("HTTP 500")` — the server's actual message
    // never reached the client. Post-bump, the client parses the `{ error }`
    // JSON body @wystack/server always sends and throws with that message.
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain("changed since review");
    expect(caught?.message).not.toBe("HTTP 500");
    expect((caught as Error & { status?: number })?.status).toBe(500);
  });

  // -------------------------------------------------------------------------
  // TOCTOU guard: credential-release refs must reflect the AUTHORITATIVE log
  // -------------------------------------------------------------------------

  it("publish releases the ref superseded by a command appended after a draft is opened, via the real HTTP path", async () => {
    // End-to-end (HTTP + real vault) coverage of the release flow: a
    // credential-superseding command appended to a draft is picked up and its
    // superseded ref released when the draft is published through the RPC.
    //
    // This does NOT reproduce the intra-publish TOCTOU race itself — the
    // append below happens before `publishDraft` is invoked, so both the old
    // (pre-transaction) and new (in-transaction) read would observe it here.
    // The race the fix closes is a command landing BETWEEN a pre-transaction
    // read and the transaction's own reload inside a single publish call; that
    // window no longer exists by construction (collection now runs strictly
    // inside the transaction, against the reloaded log — see
    // `PublishDraftOptions.beforeReplay`), and there is no pre-transaction read
    // left to race against, so a live repro isn't constructible at this layer.
    // The regression guard for that ordering lives in draft-controller.test.ts
    // ("beforeReplay observes the AUTHORITATIVE reloaded log, not a stale
    // pre-read"), which asserts the hook sees a command appended after an
    // intermediate `getDraftLog` read within the same publish flow.
    const vault = makeTestVault();
    project = await openProject({ dir: join(root, "proj") });
    const db = project.db as ArtifactDb;

    // Seed a canonical, credentialed DataSource via a real controller (so the
    // capture-before-log seam mints a real vault ref, not plaintext).
    const seedApp = await buildUserApp({ db, vault });
    const seedController = createDraftController(seedApp, db, {
      captureCredentials: (c) => captureCommandCredentials(c, vault, db),
    });
    const sourceId = crypto.randomUUID();
    const baseDraft = await seedController.openDraft();
    await seedController.appendToDraft(baseDraft, [
      cmd("CreateDataSource", {
        id: sourceId,
        type: "notion",
        name: "Base",
        apiKey: "orig-key",
      }),
    ]);
    await seedController.publishDraft(baseDraft);
    const canonicalRows = await db
      .select()
      .from(dataSources)
      .where(eq(dataSources.id, sourceId));
    const oldRef = (canonicalRows[0]!.config as Record<string, unknown>)
      .apiKey as SecretRef;
    expect(await vault.has(oldRef)).toBe(true);

    // Open the draft the RPC will publish, then append a credential-superseding
    // command to it.
    const draftId = await seedController.openDraft();

    server = await createUserServer({
      db: project.db,
      vault,
      flushSnapshot: async () => {},
    });

    await seedController.appendToDraft(draftId, [
      cmd("SetDataSourceConfig", { id: sourceId, apiKey: "rotated-key" }),
    ]);

    await postOk<{ tablesWritten: string[] }>(server.url, "publishDraft", {
      draftId,
    });

    // Collection (via `beforeReplay`) sees the appended SetDataSourceConfig
    // against the authoritative in-tx log, so the superseded ref is released
    // after publish commits.
    expect(await vault.has(oldRef)).toBe(false);
  });

  it("discard releases the ref minted by a command appended right before discard, via the real HTTP path", async () => {
    // Discard-side mirror of the publish test above: pins that a credential
    // ref minted by a command appended to the draft's log is still collected
    // and released when the draft is discarded through the RPC — the case an
    // OUTER pre-read (the old `collectDiscardCandidateRefs(artifactDb,
    // draftId, await draftController.getDraftLog(draftId))` taken before
    // `discardDraft` opened its transaction) could miss if the append landed
    // between that pre-read and the discard call.
    //
    // As with the publish test, this does not reproduce the intra-discard
    // race itself (the append below happens before `discardDraft` is
    // invoked, so both an outer pre-read and the in-transaction reload would
    // observe it here) — the regression guard for the ordering itself lives
    // in draft-controller.test.ts ("beforeDiscard observes the AUTHORITATIVE
    // reloaded log, not a stale pre-read"). This test instead pins the
    // end-to-end outcome: the ref a late-appended command mints is not
    // orphaned by discard.
    const vault = makeTestVault();
    project = await openProject({ dir: join(root, "proj") });
    const db = project.db as ArtifactDb;

    const seedApp = await buildUserApp({ db, vault });
    const seedController = createDraftController(seedApp, db, {
      captureCredentials: (c) => captureCommandCredentials(c, vault, db),
    });

    // Open the draft the RPC will discard.
    const draftId = await seedController.openDraft();

    server = await createUserServer({
      db: project.db,
      vault,
      flushSnapshot: async () => {},
    });

    // Append a fresh credentialed CreateDataSource right before discard — the
    // capture-before-log seam mints a real vault ref for it.
    const sourceId = crypto.randomUUID();
    await seedController.appendToDraft(draftId, [
      cmd("CreateDataSource", {
        id: sourceId,
        type: "notion",
        name: "Draft source",
        apiKey: "fresh-key",
      }),
    ]);
    const draftLog = await seedController.getDraftLog(draftId);
    const mintedRef = (draftLog[0]!.args as Record<string, unknown>)
      .apiKey as SecretRef;
    expect(await vault.has(mintedRef)).toBe(true);

    await postOk<void>(server.url, "discardDraft", { draftId });

    // Collection (via `beforeDiscard`) sees the appended CreateDataSource
    // against the authoritative in-tx log, so the draft-minted ref is
    // released after discard commits — never left as an inert vault orphan.
    expect(await vault.has(mintedRef)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // getDraftLog: compacted command log
  // -------------------------------------------------------------------------

  it("getDraftLog returns the compacted command log in replay order", async () => {
    project = await openProject({ dir: join(root, "proj") });
    const draftId = await seedDraft(project.db as ArtifactDb);

    server = await createUserServer({ db: project.db });

    // getDraftLog is a WyStack query → GET /api/getDraftLog?args=<json>
    const commands = await getOk<{ path: string; args: unknown }[]>(
      server.url,
      "getDraftLog",
      { draftId },
    );

    // One CreateDataSource command was appended in seedDraft.
    expect(commands.length).toBeGreaterThan(0);
    expect(commands[0]).toHaveProperty("path");
    expect(commands[0]).toHaveProperty("args");
  });
});
