/**
 * Tests for the privacy-floor write boundary in app-artifacts, and the
 * atomic auto-draft dedup contract on createInsight.
 *
 * Privacy floor: any DataFrameAnalysis written through putDataFrameEntry or
 * updateDataFrameEntry lands in the artifact DB with zero raw sampleValues.
 * The invariant is structural — it cannot be broken by the caller passing
 * sampleValues, because the boundary strips them before every write.
 *
 * Auto-draft dedup: createInsight wraps check-and-insert in a single
 * transaction so two concurrent calls for the same baseTableId always
 * converge on one unmodified draft (no TOCTOU race).
 *
 * Pattern matches commands.test.ts: real PGLite, 'should ...' names,
 * structural-invariant testing.
 */
import {
  CREDENTIAL_CLASS,
  openArtifactDb,
  schema,
} from "@dashframe/server-core";
import type { DataFrameAnalysis } from "@dashframe/types";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
  isSecretRef,
  type SecretRef,
} from "@wystack/secret-vault";
import { applyCommands, type Command, type WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { eq, sql } from "drizzle-orm";

import { functions } from "../functions";
import { LOCAL_USER_ID } from "../permissions";
import { wy } from "../wystack";
import { cmd } from "./commands";

const { dataFrames, dataSources } = schema;

/** Real vault (TestBackend) — matches credential-release.test.ts's idiom. */
function makeTestVault(): { vault: SecretVault; backend: TestBackend } {
  const backend = new TestBackend();
  const registry = new SecretRegistry();
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault(CREDENTIAL_CLASS.ConnectorKey, "test");
  const vault = new SecretVault(registry, new InMemoryMappingStore());
  return { vault, backend };
}

// A DataFrameAnalysis with raw sampleValues — simulates what analyzeDataFrame
// returns in memory before the privacy boundary strips it.
function makeAnalysisWithSamples(): DataFrameAnalysis {
  return {
    rowCount: 3,
    analyzedAt: Date.now(),
    fieldHash: "test-hash",
    columns: [
      {
        columnName: "email",
        dataType: "string",
        semantic: "email",
        cardinality: 3,
        uniqueness: 1,
        nullCount: 0,
        sampleValues: ["alice@example.com", "bob@example.com"],
        minLength: 15,
        maxLength: 17,
        avgLength: 16,
      },
      {
        columnName: "age",
        dataType: "number",
        semantic: "numerical",
        cardinality: 3,
        uniqueness: 1,
        nullCount: 0,
        sampleValues: [25, 31, 47],
        min: 25,
        max: 47,
      },
    ],
  };
}

function makeDataFrameEntry(id: string, analysis?: DataFrameAnalysis) {
  return {
    id,
    storage: { type: "s3" as const, bucket: "test", key: `arrow-${id}` },
    fieldIds: [],
    primaryKey: undefined,
    createdAt: Date.now(),
    name: "Test Frame",
    insightId: undefined,
    rowCount: 3,
    columnCount: 2,
    analysis,
  };
}

describe("privacy floor — no raw sampleValues persist in artifact DB", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-artifacts-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await wy.build({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function readAnalysis(id: string): Promise<DataFrameAnalysis | null> {
    const rows = await db.select().from(dataFrames);
    const row = rows.find((r) => r.id === id);
    return (row?.analysis as DataFrameAnalysis | null | undefined) ?? null;
  }

  async function call(path: string, args: unknown): Promise<unknown> {
    const { result } = await app.call(path, args);
    return result;
  }

  it("should strip sampleValues when writing analysis via putDataFrameEntry", async () => {
    const id = crypto.randomUUID();
    const analysis = makeAnalysisWithSamples();

    await call("putDataFrameEntry", {
      entry: makeDataFrameEntry(id, analysis),
    });

    const stored = await readAnalysis(id);
    expect(stored).not.toBeNull();
    // Every column must have an empty sampleValues array — never raw values.
    for (const col of stored!.columns) {
      expect(col.sampleValues).toEqual([]);
    }
    // Profile fields must still be present and correct.
    const emailCol = stored!.columns.find((c) => c.columnName === "email");
    expect(emailCol?.cardinality).toBe(3);
    expect(emailCol?.semantic).toBe("email");
  });

  it("fails closed instead of orphaning retained browser bytes on Insight deletion", async () => {
    const insightId = crypto.randomUUID();
    await db.insert(schema.insights).values({
      id: insightId,
      name: "Historical",
      definition: {
        baseTableId: crypto.randomUUID(),
        selectedFields: [],
        metrics: [],
      },
      createdBy: { kind: "user" },
    });
    const frameIds = [crypto.randomUUID(), crypto.randomUUID()];
    await db.insert(dataFrames).values(
      frameIds.map((id) => ({
        id,
        storage: { type: "indexeddb", key: `arrow-${id}` },
        fieldIds: [],
        name: "Historical result",
        insightId,
      })),
    );

    await expect(call("removeInsight", { id: insightId })).rejects.toThrow(
      "Legacy browser DataFrames are not supported",
    );

    expect(
      (await db.select().from(dataFrames)).filter(
        (frame) => frame.insightId === insightId,
      ),
    ).toHaveLength(2);
    expect(
      (await db.select().from(schema.insights)).some(
        (insight) => insight.id === insightId,
      ),
    ).toBe(true);
  });

  it("rejects direct creation and removal of retained browser DataFrames", async () => {
    const id = crypto.randomUUID();
    await expect(
      call("putDataFrameEntry", {
        entry: {
          ...makeDataFrameEntry(id),
          storage: { type: "indexeddb", key: `arrow-${id}` },
        },
      }),
    ).rejects.toThrow("Legacy browser DataFrames are not supported");

    await db.insert(dataFrames).values({
      id,
      storage: { type: "indexeddb", key: `arrow-${id}` },
      fieldIds: [],
      name: "Legacy",
    });
    await expect(call("removeDataFrameEntry", { id })).rejects.toThrow(
      "Only server-owned DataFrames can be removed",
    );
    expect(await db.select().from(dataFrames)).toHaveLength(1);
  });

  it("does not let public analysis updates forge or clear the current marker", async () => {
    const id = crypto.randomUUID();
    await db.insert(dataFrames).values({
      id,
      storage: { type: "file", key: id },
      fieldIds: [],
      name: "Current",
      analysis: {
        ...makeAnalysisWithSamples(),
        currentInsightResult: true,
      },
    });
    await call("updateDataFrameEntry", {
      id,
      updates: {
        analysis: {
          ...makeAnalysisWithSamples(),
          currentInsightResult: false,
        },
      },
    });

    expect((await db.select().from(dataFrames))[0]?.analysis).toMatchObject({
      currentInsightResult: true,
    });
  });

  it("resolves the canonical current Insight frame when timestamps tie", async () => {
    const insightId = crypto.randomUUID();
    const oldId = crypto.randomUUID();
    const currentId = crypto.randomUUID();
    const timestamp = new Date(100);
    await db.insert(dataFrames).values([
      {
        id: oldId,
        storage: { type: "file", key: oldId },
        fieldIds: [],
        name: "Old",
        insightId,
        lastRefreshedAt: timestamp,
        analysis: { currentInsightResult: false },
      },
      {
        id: currentId,
        storage: { type: "file", key: currentId },
        fieldIds: [],
        name: "Current",
        insightId,
        lastRefreshedAt: timestamp,
        analysis: { currentInsightResult: true },
      },
    ]);

    await expect(
      call("getDataFrameByInsight", { insightId }),
    ).resolves.toMatchObject({ id: currentId, currentInsightResult: true });
  });

  it("should strip sampleValues when updating analysis via updateDataFrameEntry", async () => {
    const id = crypto.randomUUID();
    // Insert a frame without analysis first.
    await call("putDataFrameEntry", { entry: makeDataFrameEntry(id) });

    // Now update with an analysis that carries raw sampleValues.
    const analysis = makeAnalysisWithSamples();
    await call("updateDataFrameEntry", { id, updates: { analysis } });

    const stored = await readAnalysis(id);
    expect(stored).not.toBeNull();
    for (const col of stored!.columns) {
      expect(col.sampleValues).toEqual([]);
    }
    // Numeric profile stats survive the strip.
    const ageCol = stored!.columns.find((c) => c.columnName === "age");
    expect(ageCol?.dataType).toBe("number");
    if (ageCol?.dataType === "number") {
      expect(ageCol.min).toBe(25);
      expect(ageCol.max).toBe(47);
    }
  });

  it("should clear a previously stored analysis when updated with null", async () => {
    const id = crypto.randomUUID();
    await call("putDataFrameEntry", {
      entry: makeDataFrameEntry(id, makeAnalysisWithSamples()),
    });
    expect(await readAnalysis(id)).not.toBeNull();

    await call("updateDataFrameEntry", { id, updates: { analysis: null } });

    expect(await readAnalysis(id)).toBeNull();
  });

  it("should store profiles intact when analysis has no sampleValues", async () => {
    const id = crypto.randomUUID();
    // Analysis already clean (sampleValues: []).
    const cleanAnalysis: DataFrameAnalysis = {
      rowCount: 10,
      analyzedAt: Date.now(),
      fieldHash: "hash",
      columns: [
        {
          columnName: "country",
          dataType: "string",
          semantic: "categorical",
          cardinality: 5,
          uniqueness: 0.5,
          nullCount: 0,
          sampleValues: [],
        },
      ],
    };

    await call("putDataFrameEntry", {
      entry: makeDataFrameEntry(id, cleanAnalysis),
    });

    const stored = await readAnalysis(id);
    expect(stored?.columns[0]?.cardinality).toBe(5);
    expect(stored?.columns[0]?.sampleValues).toEqual([]);
  });

  it("should leave analysis null when none is provided", async () => {
    const id = crypto.randomUUID();
    await call("putDataFrameEntry", { entry: makeDataFrameEntry(id) });

    const stored = await readAnalysis(id);
    expect(stored).toBeNull();
  });

  it("should persist data-frame origin and refresh metadata", async () => {
    const id = crypto.randomUUID();
    const sourceId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const lastRefreshedAt = Date.now();

    await call("putDataFrameEntry", {
      entry: {
        ...makeDataFrameEntry(id),
        sourceId,
        definitionId,
        lastRefreshedAt,
      },
    });

    const result = (await call("getDataFrameEntry", { id })) as {
      sourceId?: string;
      definitionId?: string;
      lastRefreshedAt?: number;
    };
    expect(result).toMatchObject({ sourceId, definitionId, lastRefreshedAt });
  });

  it("should update only lastRefreshedAt without clobbering origin metadata", async () => {
    const id = crypto.randomUUID();
    const sourceId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const lastRefreshedAt = Date.now();
    const refreshedAt = lastRefreshedAt + 1_000;

    await call("putDataFrameEntry", {
      entry: {
        ...makeDataFrameEntry(id),
        sourceId,
        definitionId,
        lastRefreshedAt,
      },
    });
    await call("updateDataFrameEntry", {
      id,
      updates: { lastRefreshedAt: refreshedAt },
    });

    const result = (await call("getDataFrameEntry", { id })) as {
      sourceId?: string;
      definitionId?: string;
      lastRefreshedAt?: number;
    };
    expect(result).toMatchObject({
      sourceId,
      definitionId,
      lastRefreshedAt: refreshedAt,
    });
  });

  it("rejects a client-authored server frame alias on insert", async () => {
    const id = crypto.randomUUID();
    await expect(
      call("putDataFrameEntry", {
        entry: {
          ...makeDataFrameEntry(id),
          storage: { type: "file", key: crypto.randomUUID() },
        },
      }),
    ).rejects.toThrow("Server frame storage is server-owned");
    expect(await db.select().from(dataFrames)).toEqual([]);
  });

  it("rejects client-authored file storage even when key matches the row id", async () => {
    const id = crypto.randomUUID();
    await expect(
      call("putDataFrameEntry", {
        entry: {
          ...makeDataFrameEntry(id),
          storage: { type: "file", key: id },
        },
      }),
    ).rejects.toThrow("Server frame storage is server-owned");
  });

  it("does not let a public update convert a server-owned frame", async () => {
    const id = crypto.randomUUID();
    await db.insert(dataFrames).values({
      id,
      storage: { type: "file", key: id },
      fieldIds: [],
      name: "server frame",
    });

    await expect(
      call("updateDataFrameEntry", {
        id,
        updates: { storage: { type: "indexeddb", key: `arrow-${id}` } },
      }),
    ).rejects.toThrow("Server frame storage cannot be changed");
    expect((await db.select().from(dataFrames))[0]?.storage).toEqual({
      type: "file",
      key: id,
    });
  });

  it("does not let public put replace a server-owned frame's storage", async () => {
    const id = crypto.randomUUID();
    await db.insert(dataFrames).values({
      id,
      storage: { type: "file", key: id },
      fieldIds: [],
      name: "server frame",
    });
    await expect(
      call("putDataFrameEntry", {
        entry: makeDataFrameEntry(id),
      }),
    ).rejects.toThrow("Server frame storage cannot be changed");
  });

  it("does not let a public update move a current server frame to another Insight", async () => {
    const id = crypto.randomUUID();
    const insightId = crypto.randomUUID();
    await db.insert(dataFrames).values({
      id,
      storage: { type: "file", key: id },
      fieldIds: [],
      name: "current",
      insightId,
      analysis: { currentInsightResult: true },
    });

    await expect(
      call("updateDataFrameEntry", {
        id,
        updates: { insightId: crypto.randomUUID() },
      }),
    ).rejects.toThrow("Server frame ownership cannot be changed");
    expect((await db.select().from(dataFrames))[0]?.insightId).toBe(insightId);
  });

  it("fails clear-all before deleting retained browser metadata", async () => {
    const id = crypto.randomUUID();
    await db.insert(dataFrames).values({
      id,
      storage: { type: "indexeddb", key: `arrow-${id}` },
      fieldIds: [],
      name: "legacy",
    });

    await expect(call("clearAllData", {})).rejects.toThrow(
      "Only server-owned DataFrames can be removed",
    );
    expect(await db.select().from(dataFrames)).toHaveLength(1);
  });

  it("rejects changing a DataFrame to another server frame's key", async () => {
    const id = crypto.randomUUID();
    await call("putDataFrameEntry", { entry: makeDataFrameEntry(id) });

    await expect(
      call("updateDataFrameEntry", {
        id,
        updates: { storage: { type: "file", key: crypto.randomUUID() } },
      }),
    ).rejects.toThrow("Server frame storage is server-owned");

    const [stored] = await db.select().from(dataFrames);
    expect(stored?.storage).toEqual({
      type: "s3",
      bucket: "test",
      key: `arrow-${id}`,
    });
  });
});

// ---------------------------------------------------------------------------
// createInsight — atomic auto-draft dedup (TOCTOU fix)
// ---------------------------------------------------------------------------
//
// Contract: dedup is opt-in via `reuseUnmodifiedDraft`. When set, two concurrent
// createInsight calls for the same baseTableId — both unmodified-draft shape —
// converge on exactly ONE insight row. The check-and-insert runs inside a single
// transaction, so the dedup decision is atomic with the write. Without the flag,
// createInsight always inserts a fresh row (explicit-creation intent).
//
// PGLite is single-connection: true concurrent writes serialize at the event
// loop rather than via OS-level locking. The structural fix is therefore
// tested the same way as GetOrCreateDataSource in commands.test.ts — by
// checking the RESULT (one row, same id), not by forcing a true interleave.
// Two sequential calls that both start from "no existing draft" are the
// minimal probe: the pre-fix code would insert two rows; the post-fix code
// returns the existing row on the second call.

describe("createInsight — atomic auto-draft dedup", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;

  const { insights } = schema;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-dedup-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await wy.build({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function call(path: string, args: unknown): Promise<unknown> {
    const { result } = await app.call(path, args);
    return result;
  }

  async function allInsights() {
    return db.select().from(insights);
  }

  it("should return the existing unmodified draft on a second reuse call for the same table", async () => {
    const tableId = crypto.randomUUID();

    const first = (await call("createInsight", {
      name: "orders",
      baseTableId: tableId,
      options: { selectedFields: [], reuseUnmodifiedDraft: true },
    })) as { id: string };

    const second = (await call("createInsight", {
      name: "orders",
      baseTableId: tableId,
      options: { selectedFields: [], reuseUnmodifiedDraft: true },
    })) as { id: string };

    // `call` is untyped, so pin that an id came back at all before comparing:
    // if the handler stopped returning one, both sides would be `undefined`
    // and the equality below would pass vacuously.
    expect(typeof first.id).toBe("string");

    // Both calls must return the same id — the second reuses the first draft.
    expect(second.id).toBe(first.id);

    // Exactly one row in the DB — no duplicate draft created — and the
    // returned id is that row's, not some value the handler invented.
    const rows = await allInsights();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.id);
  });

  it("should produce exactly one unmodified draft when two reuse calls fire without awaiting the first (TOCTOU simulation)", async () => {
    // Both calls start before either resolves, simulating the race. On PGLite
    // (single-connection WASM) the event loop serializes them, but the FIX is
    // structural: the transaction prevents a second insert after the first
    // commits. Without the fix, both calls would insert (both read "no draft"
    // before either inserts). The test pins the POST-FIX contract.
    const tableId = crypto.randomUUID();

    const [r1, r2] = (await Promise.all([
      call("createInsight", {
        name: "orders",
        baseTableId: tableId,
        options: { selectedFields: [], reuseUnmodifiedDraft: true },
      }),
      call("createInsight", {
        name: "orders",
        baseTableId: tableId,
        options: { selectedFields: [], reuseUnmodifiedDraft: true },
      }),
    ])) as [{ id: string }, { id: string }];

    // Pin that an id came back before comparing — two `undefined`s are equal,
    // so the assertion below is vacuous without this.
    expect(typeof r1.id).toBe("string");

    // Both calls must resolve to the same id.
    expect(r1.id).toBe(r2.id);

    // Exactly one insight row — no duplicate draft — and it is the row both
    // calls returned.
    const rows = await allInsights();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(r1.id);
  });

  it("should still create a draft when an unrelated insight row is corrupt", async () => {
    // The dedup scan decodes rows looking for a reusable draft, so failing
    // closed on a corrupt blob would let one bad row anywhere in the table
    // block createInsight for every unrelated baseTableId. It fails OPEN: an
    // undecodable row is skipped.
    //
    // The reuse call below targets a baseTableId with NO existing draft, so
    // `rows.find` cannot short-circuit and must decode every row — including
    // the corrupt one — whatever order the scan returns them in. Postgres (and
    // so PGlite) does not guarantee row order without ORDER BY, so the test
    // must not depend on the corrupt row landing before any match.
    const { id: corruptId } = (await call("createInsight", {
      name: "unrelated",
      baseTableId: crypto.randomUUID(),
      options: { selectedFields: [] },
    })) as { id: string };
    // `sorts` must be an array — an object fails the stored schema structurally.
    await db
      .update(insights)
      .set({ definition: { baseTableId: crypto.randomUUID(), sorts: {} } })
      .where(eq(insights.id, corruptId));

    // No draft exists for this table, so the scan traverses the whole table and
    // then inserts. Failing closed, the corrupt row makes this throw instead.
    const created = (await call("createInsight", {
      name: "orders",
      baseTableId: crypto.randomUUID(),
      options: { selectedFields: [], reuseUnmodifiedDraft: true },
    })) as { id: string };

    // Pin the shape before asserting. `call` returns `unknown` and the cast is
    // unchecked, so a drifted result shape would read `undefined` and a laxer
    // assertion would pass green while testing nothing.
    expect(typeof created.id).toBe("string");
    expect(created.id).not.toBe(corruptId);
    expect(await allInsights()).toHaveLength(2);
  });

  it("should still create a new draft when the existing insight has been modified", async () => {
    // A modified insight (selectedFields populated) must NOT be reused as a
    // draft — even a reuse call should insert a fresh row.
    const tableId = crypto.randomUUID();

    // First: create a draft and simulate modification by calling updateInsight.
    const { id: draftId } = (await call("createInsight", {
      name: "orders",
      baseTableId: tableId,
      options: { selectedFields: [], reuseUnmodifiedDraft: true },
    })) as { id: string };

    await call("updateInsight", {
      id: draftId,
      updates: { selectedFields: ["field-1"] },
    });

    // Second: create another draft for the same table — must be a NEW row.
    const second = (await call("createInsight", {
      name: "orders (2)",
      baseTableId: tableId,
      options: { selectedFields: [], reuseUnmodifiedDraft: true },
    })) as { id: string };

    expect(second.id).not.toBe(draftId);

    const rows = await allInsights();
    expect(rows).toHaveLength(2);
  });

  it("should always insert when the incoming insight is pre-populated, even with reuse requested", async () => {
    // When the caller passes selectedFields, the incoming insight is NOT a
    // draft — even with reuseUnmodifiedDraft set, a fresh row is created.
    const tableId = crypto.randomUUID();

    // Create an unmodified draft first.
    const { id: draftId } = (await call("createInsight", {
      name: "orders",
      baseTableId: tableId,
      options: { selectedFields: [], reuseUnmodifiedDraft: true },
    })) as { id: string };

    // Create a pre-populated insight — should NOT reuse the draft.
    const prepopulated = (await call("createInsight", {
      name: "orders with fields",
      baseTableId: tableId,
      options: {
        selectedFields: ["field-a", "field-b"],
        reuseUnmodifiedDraft: true,
      },
    })) as { id: string };

    expect(prepopulated.id).not.toBe(draftId);

    const rows = await allInsights();
    expect(rows).toHaveLength(2);
  });

  it("should always insert when reuse is not requested, even when an unmodified draft exists", async () => {
    // Dedup is opt-in. The derived-insight path (createInsightFromInsight) omits
    // reuseUnmodifiedDraft, so an empty incoming insight still creates a fresh
    // row rather than being rerouted to an existing draft.
    const tableId = crypto.randomUUID();

    // Create an unmodified draft via the reuse path.
    const { id: draftId } = (await call("createInsight", {
      name: "orders",
      baseTableId: tableId,
      options: { selectedFields: [], reuseUnmodifiedDraft: true },
    })) as { id: string };

    // An empty call WITHOUT the reuse flag must create a new row.
    const derived = (await call("createInsight", {
      name: "orders (derived)",
      baseTableId: tableId,
      options: { selectedFields: [] },
    })) as { id: string };

    expect(derived.id).not.toBe(draftId);

    const rows = await allInsights();
    expect(rows).toHaveLength(2);
  });

  it("should insert a fresh suffixed draft when reuse is explicitly false", async () => {
    // The client's suffix path (createInsightFromTable when a modified insight
    // already exists) sends reuseUnmodifiedDraft: false so the named draft is
    // created rather than rerouted to an existing unmodified "orders" draft.
    const tableId = crypto.randomUUID();

    const { id: draftId } = (await call("createInsight", {
      name: "orders",
      baseTableId: tableId,
      options: { selectedFields: [], reuseUnmodifiedDraft: true },
    })) as { id: string };

    // Explicit reuse=false with the suffixed name must produce a NEW row, even
    // though an unmodified "orders" draft already exists for this table.
    const suffixed = (await call("createInsight", {
      name: "orders (2)",
      baseTableId: tableId,
      options: { selectedFields: [], reuseUnmodifiedDraft: false },
    })) as { id: string };

    expect(suffixed.id).not.toBe(draftId);

    const rows = await allInsights();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual(["orders", "orders (2)"]);
  });
});

// ---------------------------------------------------------------------------
// patchDataTableArray — Zod discriminated-union guard at the handler boundary
// ---------------------------------------------------------------------------
//
// Contract: the handler rejects malformed inputs with a structured error BEFORE
// calling patchDataTableItems, so malformed JSONB payloads from any untrusted
// client path never reach the helper.  The guard messages are distinct from the
// helper's own throws — commenting the guard out makes these tests RED, proving
// they exercise the guard, not the helper.
//
// The three DoD tests from the ticket spec:
//   (1) mode=add without `value` → structured error
//   (2) mode=update without `itemId` → structured error
//   (3) mode=delete — valid path — passes (guard does not block legitimate calls)

describe("patchDataTableArray — Zod guard rejects malformed inputs", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-patch-dt-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await wy.build({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function call(path: string, args: unknown): Promise<unknown> {
    const { result } = await app.call(path, args);
    return result;
  }

  it("should reject mode=add with no value — guard fires before helper", async () => {
    // mode=add requires value (object with id).  The guard emits a Zod v4
    // structured error (JSON issues array, e.g. '...expected object...').
    // The helper's own error "fields must be an object with an id" is never
    // reached — and the guard message is structurally distinct from it.
    //
    // The guard runs before loadDataTable, so no real DB row is needed.
    const dataTableId = crypto.randomUUID();
    await expect(
      call("patchDataTableArray", {
        dataTableId,
        kind: "fields",
        mode: "add",
        // value intentionally omitted
      }),
      // Zod v4 error.message is a JSON issues array: '[ { "expected": "object", ... } ]'
      // Distinct from the helper's plain-English "fields must be an object with an id"
    ).rejects.toThrow(/expected.*object/i);
  });

  it("should reject mode=update with no itemId — guard fires before helper", async () => {
    // mode=update requires itemId.  Guard emits a Zod v4 structured error.
    // The helper's "itemId is required for update" is never reached.
    // Guard runs before loadDataTable — no real DB row needed.
    const dataTableId = crypto.randomUUID();
    await expect(
      call("patchDataTableArray", {
        dataTableId,
        kind: "fields",
        mode: "update",
        value: { name: "renamed" },
        // itemId intentionally omitted
      }),
      // Zod v4 error.message: '[ { "expected": "string", ... } ]'
      // Distinct from helper's "itemId is required for update"
    ).rejects.toThrow(/expected.*string/i);
  });

  it("should pass valid mode=delete with itemId through the guard", async () => {
    // A well-formed delete passes the guard and reaches loadDataTable, which
    // throws "not found" for a nonexistent row — domain error, not guard error.
    const dataTableId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    await expect(
      call("patchDataTableArray", {
        dataTableId,
        kind: "fields",
        mode: "delete",
        itemId,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("should reject an unsupported mode before reaching the helper", async () => {
    // Zod discriminated union rejects an unrecognized discriminator value.
    // Guard runs before loadDataTable — no real DB row needed.
    const dataTableId = crypto.randomUUID();
    await expect(
      call("patchDataTableArray", {
        dataTableId,
        kind: "fields",
        mode: "bogusMode",
      }),
      // Zod v4 error for invalid union discriminator uses code "invalid_union".
    ).rejects.toThrow(/invalid_union/i);
  });
});

// ---------------------------------------------------------------------------
// patchInsight — Zod discriminated-union guard at the handler boundary
// ---------------------------------------------------------------------------
//
// Same pattern: handler validates before calling patchInsightDefinition.
// Guard messages are distinct from helper throws — these tests go RED without
// the guard, proving they test the boundary, not the helper internals.

describe("patchInsight — Zod guard rejects malformed inputs", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-patch-insight-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await wy.build({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function call(path: string, args: unknown): Promise<unknown> {
    const { result } = await app.call(path, args);
    return result;
  }

  it("should reject mode=addMetric with no metric — guard fires before helper", async () => {
    // mode=addMetric requires metric (record/object).  Guard emits a Zod v4
    // structured error; the helper's "metric must include id, name, sourceTable,
    // and aggregation" is never reached.
    //
    // The guard runs before loadInsight, so no real DB row is needed.
    const id = crypto.randomUUID();
    await expect(
      call("patchInsight", {
        id,
        mode: "addMetric",
        // metric intentionally omitted
      }),
      // Zod v4 error.message: '[ { "expected": "record", ... } ]'
      // Distinct from helper's "metric must include id, name, sourceTable, and aggregation"
    ).rejects.toThrow(/expected.*record/i);
  });

  it("should reject mode=addField with no fieldId — guard fires before helper", async () => {
    // Guard runs before loadInsight — no real DB row needed.
    const id = crypto.randomUUID();
    await expect(
      call("patchInsight", {
        id,
        mode: "addField",
        // fieldId intentionally omitted
      }),
      // Zod v4 error.message: '[ { "expected": "string", ... } ]'
      // Distinct from helper's "fieldId is required for addField"
    ).rejects.toThrow(/expected.*string/i);
  });

  it("should reject an unsupported mode before reaching the helper", async () => {
    // Zod discriminated union rejects an unrecognized discriminator value.
    // Guard runs before loadInsight — no real DB row needed.
    const id = crypto.randomUUID();
    await expect(
      call("patchInsight", {
        id,
        mode: "bogusMode",
      }),
      // Zod v4 error for invalid union discriminator uses code "invalid_union".
    ).rejects.toThrow(/invalid_union/i);
  });
});

// ---------------------------------------------------------------------------
// Command credential writes — same-operation minted-ref rollback
// ---------------------------------------------------------------------------
//
// These command handlers mint a vault ref (a real keychain-class write via
// storeCredential) BEFORE the canonical DB insert/update. Without a rollback, a
// DB failure after the mint orphans the freshly-stored secret forever (no row
// references it, so no lifecycle transition can ever find and release it).
//
// The fix collects only refs minted in THIS call and releases them best-effort
// on a write failure, then rethrows. HARD INVARIANT under test in (2): a
// pre-existing canonical ref on an untouched field must never be released just
// because a DIFFERENT field's write failed in the same call — releasing it would
// destroy a live credential.

describe("command credential writes — same-operation minted-ref rollback", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  let vault: SecretVault;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-cred-rollback-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    ({ vault } = makeTestVault());
    app = await wy.build({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function commit(commands: Command[]): Promise<unknown> {
    return applyCommands(app, commands, {
      mode: "commit",
      context: {
        vault,
        principal: { kind: "user", userId: LOCAL_USER_ID },
      },
    });
  }

  it("releases the same-operation minted ref when the insert fails, and the error propagates", async () => {
    const id = crypto.randomUUID();
    // A real PK conflict reaches the transaction-bound Drizzle handle that the
    // command uses (unlike a mock on the outer tracker).
    await commit([
      cmd("CreateDataSource", {
        id,
        type: "notion",
        name: "Existing",
      }),
    ]);

    const storeSpy = vi.spyOn(vault, "store");

    // Assert on the underlying driver error (surfaced via `.cause` — Drizzle
    // wraps it in a "Failed query" error), not just "it threw something": a
    // future refactor that throws earlier, for an unrelated reason, must not
    // satisfy this test vacuously.
    let insertError: Error | undefined;
    await commit([
      cmd("CreateDataSource", {
        id,
        type: "notion",
        name: "Will Fail",
        apiKey: "plaintext-key",
      }),
    ]).catch((e: Error) => {
      insertError = e;
    });
    expect(insertError).toBeDefined();
    expect((insertError?.cause as Error | undefined)?.message).toMatch(
      /duplicate key value violates unique constraint "data_sources_pkey"/,
    );

    // The conflicting write rolled back: only the seed row remains, and it has
    // no credential field that could reference this call's minted ref.
    const rows = await db.select().from(dataSources);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
    expect((rows[0]?.config as { apiKey?: unknown }).apiKey).toBeUndefined();

    // The rollback released the ref this call minted (captured via the store spy,
    // since it never lands anywhere else once the insert fails).
    expect(storeSpy).toHaveBeenCalledTimes(1);
    const mintedRef = await storeSpy.mock.results[0]?.value;
    expect(isSecretRef(mintedRef)).toBe(true);
    expect(await vault.has(mintedRef)).toBe(false);
  });

  it("releases the same-op minted ref and leaves untouched fields' refs intact when the update write fails", async () => {
    // Seed a row with a live connectionString ref via a successful command.
    const id = crypto.randomUUID();
    await commit([
      cmd("CreateDataSource", {
        id,
        type: "postgres",
        name: "Seed",
        connectionString: "postgres://seed",
      }),
    ]);

    const before = await db.select().from(dataSources);
    const priorConnectionStringRaw = (
      before[0]?.config as { connectionString?: unknown }
    ).connectionString;
    expect(isSecretRef(priorConnectionStringRaw)).toBe(true);
    const priorConnectionString = priorConnectionStringRaw as SecretRef;
    expect(await vault.has(priorConnectionString)).toBe(true);

    // Add a test-local check after the seed exists. The update below now fails
    // inside the transaction-bound DB handle, rather than relying on an outer
    // tracker mock that applyCommands never calls.
    await db.execute(
      sql.raw(`
      ALTER TABLE "data_sources"
      ADD CONSTRAINT "data_sources_test_api_key_check"
      CHECK (("config" ->> 'apiKey') IS NULL)
    `),
    );

    // Now update apiKey (a DIFFERENT field) and force a real DB constraint
    // failure. connectionString is left untouched — its pre-existing ref must
    // survive.
    const storeSpy = vi.spyOn(vault, "store");

    // Assert on the named test-local CHECK constraint via `.cause`, not just
    // "it threw something" — pins the failure to the exact write this test
    // means to exercise, so a future refactor that throws earlier for an
    // unrelated reason can't satisfy this test vacuously.
    let updateError: Error | undefined;
    await commit([
      cmd("SetDataSourceConfig", {
        id,
        apiKey: "new-api-key-plaintext",
      }),
    ]).catch((e: Error) => {
      updateError = e;
    });
    expect(updateError).toBeDefined();
    expect((updateError?.cause as Error | undefined)?.message).toMatch(
      /violates check constraint "data_sources_test_api_key_check"/,
    );

    // Positive half: the apiKey ref minted by THIS call was released by the
    // compensation (captured via the store spy, since it never lands anywhere
    // else once the update fails).
    expect(storeSpy).toHaveBeenCalledTimes(1);
    const newApiKeyRef = await storeSpy.mock.results[0]?.value;
    expect(isSecretRef(newApiKeyRef)).toBe(true);
    expect(await vault.has(newApiKeyRef)).toBe(false);

    // Guardrail: the pre-existing connectionString ref is untouched by the failed
    // apiKey write — it must still be live.
    expect(await vault.has(priorConnectionString)).toBe(true);

    // The row itself was never updated (write failed before/at the DB call).
    const after = await db.select().from(dataSources);
    const afterConfig = after[0]?.config as {
      apiKey?: unknown;
      connectionString?: string;
    };
    expect(afterConfig.connectionString).toBe(priorConnectionString);
    expect(afterConfig.apiKey).toBeUndefined();
  });

  it("succeeds unchanged on the happy path: the minted ref persists and the row is written", async () => {
    const id = crypto.randomUUID();
    await commit([
      cmd("CreateDataSource", {
        id,
        type: "notion",
        name: "Happy Path",
        apiKey: "plaintext-key",
      }),
    ]);

    const rows = await db.select().from(dataSources);
    expect(rows.length).toBe(1);
    const config = rows[0]?.config as { apiKey?: unknown };
    expect(isSecretRef(config.apiKey)).toBe(true);
    expect(await vault.has(config.apiKey as SecretRef)).toBe(true);
    expect(rows[0]?.id).toBe(id);
  });

  it("persists connector-specific config beside a vault-backed credential", async () => {
    const id = crypto.randomUUID();
    await commit([
      cmd("CreateDataSource", {
        id,
        type: "postgres",
        name: "Warehouse",
        connectionString: "postgres://user:secret@host/db",
      }),
      cmd("SetDataSourceConfig", { id, extra: { defaultSchema: "analytics" } }),
    ]);

    const rows = await db.select().from(dataSources);
    const config = rows[0]?.config as {
      connectionString?: unknown;
      defaultSchema?: unknown;
    };
    expect(config.defaultSchema).toBe("analytics");
    expect(isSecretRef(config.connectionString)).toBe(true);
    expect(JSON.stringify(config)).not.toContain("postgres://user:secret");
  });

  it("rejects credentials smuggled through command extra config", async () => {
    const id = crypto.randomUUID();
    await commit([
      cmd("CreateDataSource", {
        id,
        type: "postgres",
        name: "Safe",
      }),
    ]);
    await expect(
      commit([
        cmd("SetDataSourceConfig", {
          id,
          extra: { connectionString: "postgres://plaintext" },
        }),
      ]),
    ).rejects.toThrow(/typed credential fields/i);
  });
});

// ---------------------------------------------------------------------------
// Regression: `source` must survive every read-modify-write.
//
// `decodeInsight` returns the domain `Insight`, which deliberately has no
// `source` — it is storage-level composition wiring, not a domain field. Both
// write paths used to rebuild `definition` from that decoded `Insight`, so any
// rename or field/metric patch silently erased the source. The user-visible
// damage is not just a lost pointer: `wouldCreateCycle` in `commands.ts` walks
// `definition.source`, so a source-less insight reads as a leaf and the guard
// stops seeing the edge — admitting an A→B→A cycle it is there to reject.
// ---------------------------------------------------------------------------

describe("insight writes preserve `source` (Insight-on-Insight composition)", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-insight-source-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await wy.build({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function call(path: string, args: unknown): Promise<unknown> {
    const { result } = await app.call(path, args);
    return result;
  }

  async function storedDefinition(
    id: string,
  ): Promise<Record<string, unknown>> {
    const [row] = await db
      .select()
      .from(schema.insights)
      .where(eq(schema.insights.id, id));
    if (!row) throw new Error(`test setup: insight ${id} not found`);
    return row.definition as Record<string, unknown>;
  }

  /** Create an insight, then compose it onto `sourceInsightId`. */
  async function makeComposedInsight(baseTableId: string) {
    const sourceInsightId = baseTableId;
    const { id } = (await call("createInsight", {
      name: "Derived",
      baseTableId,
      options: { selectedFields: [] },
    })) as { id: string };

    // Compose it — the shape SetInsightSource persists.
    await db
      .update(schema.insights)
      .set({
        definition: {
          ...(await storedDefinition(id)),
          source: { sourceType: "insight", sourceId: sourceInsightId },
        },
      })
      .where(eq(schema.insights.id, id));

    return { id, sourceInsightId };
  }

  async function storedSource(id: string) {
    return (await storedDefinition(id)).source;
  }

  it("should keep `source` when updateInsight only renames the insight", async () => {
    const baseTableId = crypto.randomUUID();
    const { id, sourceInsightId } = await makeComposedInsight(baseTableId);

    await call("updateInsight", { id, updates: { name: "Renamed" } });

    expect(await storedSource(id)).toEqual({
      sourceType: "insight",
      sourceId: sourceInsightId,
    });
  });

  it("should allow updateInsight to repeat an unchanged base table", async () => {
    const baseTableId = crypto.randomUUID();
    const { id, sourceInsightId } = await makeComposedInsight(baseTableId);

    await call("updateInsight", {
      id,
      updates: { name: "Renamed", baseTableId },
    });

    expect(await storedSource(id)).toEqual({
      sourceType: "insight",
      sourceId: sourceInsightId,
    });
  });

  it("should ignore a `source` supplied through updateInsight", async () => {
    // `source` is a valid schema key, so an untyped `updates` payload carrying
    // one would otherwise write a composition edge that never passed
    // `requireSourceExists`/`wouldCreateCycle` — here, a self-cycle.
    const baseTableId = crypto.randomUUID();
    const { id, sourceInsightId } = await makeComposedInsight(baseTableId);

    await call("updateInsight", {
      id,
      updates: { source: { sourceType: "insight", sourceId: id } },
    });

    expect(await storedSource(id)).toEqual({
      sourceType: "insight",
      sourceId: sourceInsightId,
    });
  });

  it("should keep `source` when patchInsight adds a field", async () => {
    const baseTableId = crypto.randomUUID();
    const { id, sourceInsightId } = await makeComposedInsight(baseTableId);

    await call("patchInsight", {
      id,
      mode: "addField",
      fieldId: crypto.randomUUID(),
    });

    expect(await storedSource(id)).toEqual({
      sourceType: "insight",
      sourceId: sourceInsightId,
    });
  });

  it("should reject updateInsight when it repoints the base table", async () => {
    const baseTableId = crypto.randomUUID();
    const { id, sourceInsightId } = await makeComposedInsight(baseTableId);

    await expect(
      call("updateInsight", {
        id,
        updates: { baseTableId: crypto.randomUUID() },
      }),
    ).rejects.toThrow(
      "updateInsight cannot repoint baseTableId; use SetInsightSource",
    );

    expect(await storedDefinition(id)).toMatchObject({
      baseTableId,
      source: { sourceType: "insight", sourceId: sourceInsightId },
    });
  });

  it("should reject runtime controls through legacy updateInsight", async () => {
    const baseTableId = crypto.randomUUID();
    const { id } = (await call("createInsight", {
      name: "Runtime control target",
      baseTableId,
    })) as { id: string };

    await expect(
      call("updateInsight", {
        id,
        updates: { runtimeControls: { limit: { min: 1, max: 10 } } },
      }),
    ).rejects.toThrow(
      "updateInsight cannot set runtimeControls; use SetInsightRuntimeControls",
    );
    expect((await storedDefinition(id)).runtimeControls).toBeUndefined();
  });

  it("should reject a malformed updates payload instead of persisting it", async () => {
    const baseTableId = crypto.randomUUID();
    const { id } = (await call("createInsight", {
      name: "Malformed update target",
      baseTableId,
    })) as { id: string };

    await expect(
      call("updateInsight", {
        id,
        updates: { metrics: "not-an-array" },
      }),
    ).rejects.toThrow();
  });

  it("should reject a non-string name instead of writing it to the row", async () => {
    // `name` is a row column, not part of the definition blob, so the schema
    // parse that guards everything else never sees it.
    const baseTableId = crypto.randomUUID();
    const { id } = (await call("createInsight", {
      name: "Name guard target",
      baseTableId,
    })) as { id: string };

    await expect(
      call("updateInsight", { id, updates: { name: { not: "a string" } } }),
    ).rejects.toThrow(/name must be a string/);

    const [row] = await db
      .select()
      .from(schema.insights)
      .where(eq(schema.insights.id, id));
    expect(row?.name).toBe("Name guard target");
  });

  it("should leave the project readable after a rejected update", async () => {
    const baseTableId = crypto.randomUUID();
    const { id } = (await call("createInsight", {
      name: "Readable update target",
      baseTableId,
    })) as { id: string };
    const before = await storedDefinition(id);

    await expect(
      call("updateInsight", {
        id,
        updates: { metrics: "not-an-array" },
      }),
    ).rejects.toThrow();

    expect(await storedDefinition(id)).toEqual(before);
    await expect(call("listInsights", {})).resolves.toEqual([
      expect.objectContaining({ id }),
    ]);
  });

  it("should reject a non-array in createInsight options instead of minting an undecodable row", async () => {
    // `options` arrives as opaque `jsonb`; `encodeInsightDefinition` does not
    // validate, and `{}` is not nullish so `?? []` does not catch it. An
    // unvalidated INSERT is worse than an unvalidated update: it mints a row
    // that can never be decoded, and because `listInsights` decodes every row,
    // one such row takes out the whole list — including insights the caller
    // never touched. `updateInsight`/`patchInsight` already parse; so must this.
    const baseTableId = crypto.randomUUID();
    const { id: healthyId } = (await call("createInsight", {
      name: "Healthy sibling",
      baseTableId,
    })) as { id: string };

    await expect(
      call("createInsight", {
        name: "Poison",
        baseTableId,
        options: { selectedFields: {} },
      }),
      // Pin the reason, not just the fact of a rejection: a bare `toThrow()`
      // stays green if the call starts failing for an unrelated cause (input
      // coercion, transaction error) while the definition guard is gone.
    ).rejects.toThrow(/selectedFields/);

    // Nothing was minted, and the sibling is still listable.
    const rows = await db.select().from(schema.insights);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(healthyId);
    await expect(call("listInsights", {})).resolves.toEqual([
      expect.objectContaining({ id: healthyId }),
    ]);
  });

  it("should reject a non-array even when the reuse branch would short-circuit the insert", async () => {
    // The guard has to sit above EVERY exit from the handler, not just above
    // the insert. `isUnmodifiedDraft` reads `.length` off each array, so a
    // non-array `selectedFields: {}` gives `undefined ?? 0 === 0` and reads as
    // "unmodified" — with an existing draft to reuse, the handler returns that
    // draft's id and never reaches the insert. The malformed request would
    // report success, and the fields the caller asked for would vanish.
    const baseTableId = crypto.randomUUID();
    const { id: draftId } = (await call("createInsight", {
      name: "Auto draft",
      baseTableId,
      options: { reuseUnmodifiedDraft: true },
    })) as { id: string };

    await expect(
      call("createInsight", {
        name: "Poison",
        baseTableId,
        options: { reuseUnmodifiedDraft: true, selectedFields: {} },
      }),
    ).rejects.toThrow(/selectedFields/);

    // The reusable draft is untouched and still the only row.
    const rows = await db.select().from(schema.insights);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(draftId);
  });
});

// ---------------------------------------------------------------------------
// GA4 token write-back — concurrent refresh must not orphan a vault ref
// ---------------------------------------------------------------------------
//
// Writing a refreshed bundle is a read-modify-write: read the source's config,
// store a new secret, write the config, then release the ref the read saw. Run
// two of those interleaved and each computes "the old ref" from its own read,
// so one minted ref ends up stored with no config pointing at it and nothing
// that will ever release it. Nothing detects that later — the vault has no
// listing operation, so an orphan is invisible by construction.
//
// The assertion that discriminates fixed from broken is that exactly one of the
// two minted refs is still live. "One config write happened" would pass on the
// broken code too.

describe("GA4 refreshed-token write-back under concurrency", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  let vault: SecretVault;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-ga4-refresh-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    ({ vault } = makeTestVault());
    app = await wy.build({ db, functions });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves exactly one live credential ref when two refreshes race", async () => {
    // An already-expired bundle, so both calls take the refresh path.
    const expired = JSON.stringify({
      version: 1,
      clientId: "client-id",
      accessToken: "stale-access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 60_000,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    const originalRef = await vault.store(expired, {
      class: CREDENTIAL_CLASS.ConnectorKey,
    });
    const dataSourceId = crypto.randomUUID();
    await db.insert(dataSources).values({
      id: dataSourceId,
      name: "GA4",
      kind: "googleAnalytics",
      storage: "live",
      config: { apiKey: originalRef },
      createdBy: { kind: "user" },
    });

    const minted: SecretRef[] = [];
    const realStore = vault.store.bind(vault);
    vi.spyOn(vault, "store").mockImplementation(async (plaintext, opts) => {
      const ref = await realStore(plaintext, opts);
      minted.push(ref);
      return ref;
    });

    // Both calls interleave around the token endpoint: each has read the
    // source's config before either has written one back.
    let releaseToken: (() => void) | undefined;
    const bothRefreshing = new Promise<void>((resolve) => {
      let arrived = 0;
      releaseToken = () => {
        if (++arrived === 2) resolve();
      };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          String(input instanceof Request ? input.url : input),
        );
        // Compared as a parsed origin rather than a substring, so a host that
        // merely contains this one cannot match.
        if (url.origin === "https://oauth2.googleapis.com") {
          releaseToken?.();
          await bothRefreshing;
          return new Response(
            JSON.stringify({
              access_token: `fresh-${crypto.randomUUID()}`,
              expires_in: 3600,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ accountSummaries: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const context = {
      vault,
      googleOAuth: { clientId: "client-id", clientSecret: "client-secret" },
      flushSnapshot: async () => {},
    };
    await Promise.all([
      app.call("listGa4Properties", { dataSourceId }, context),
      app.call("listGa4Properties", { dataSourceId }, context),
    ]);

    // Both refreshes minted a ref; only the one the config points at survives.
    expect(minted).toHaveLength(2);
    const [row] = await db
      .select()
      .from(dataSources)
      .where(eq(dataSources.id, dataSourceId));
    const live = (row?.config as { apiKey?: SecretRef }).apiKey;
    expect(isSecretRef(live)).toBe(true);
    expect(minted).toContain(live);
    const survivors: SecretRef[] = [];
    for (const ref of [originalRef, ...minted]) {
      if (await vault.has(ref)) survivors.push(ref);
    }
    expect(survivors).toEqual([live]);
  });
});
