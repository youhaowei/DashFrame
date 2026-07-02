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
import { openArtifactDb, schema } from "@dashframe/server-core";
import type { DataFrameAnalysis } from "@dashframe/types";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
  isSecretRef,
  type SecretRef,
} from "@wystack/secret-vault";
import { createWyStack, type WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { functions } from "../functions";

const { dataFrames, dataSources } = schema;

/** Real vault (TestBackend) — matches credential-release.test.ts's idiom. */
function makeTestVault(): { vault: SecretVault; backend: TestBackend } {
  const backend = new TestBackend();
  const registry = new SecretRegistry();
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault("connector-key", "test");
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
    storage: { type: "indexeddb" as const, key: `arrow-${id}` },
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
    app = await createWyStack({ db, functions });
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
    app = await createWyStack({ db, functions });
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

    // Both calls must return the same id — the second reuses the first draft.
    expect(second.id).toBe(first.id);

    // Exactly one row in the DB — no duplicate draft created.
    const rows = await allInsights();
    expect(rows).toHaveLength(1);
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

    // Both calls must resolve to the same id.
    expect(r1.id).toBe(r2.id);

    // Exactly one insight row — no duplicate draft.
    const rows = await allInsights();
    expect(rows).toHaveLength(1);
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
    app = await createWyStack({ db, functions });
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
    app = await createWyStack({ db, functions });
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
// addDataSource / updateDataSource — same-operation minted-ref rollback
// ---------------------------------------------------------------------------
//
// These legacy coarse handlers mint a vault ref (a real keychain-class write via
// storeCredential) BEFORE the canonical DB insert/update. Without a rollback, a
// DB failure after the mint orphans the freshly-stored secret forever (no row
// references it, so no lifecycle transition can ever find and release it).
//
// The fix collects only refs minted in THIS call and releases them best-effort
// on a write failure, then rethrows. HARD INVARIANT under test in (2): a
// pre-existing canonical ref on an untouched field must never be released just
// because a DIFFERENT field's write failed in the same call — releasing it would
// destroy a live credential.

describe("addDataSource / updateDataSource — same-operation minted-ref rollback", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  let vault: SecretVault;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-cred-rollback-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    ({ vault } = makeTestVault());
    app = await createWyStack({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function call(path: string, args: unknown): Promise<unknown> {
    const { result } = await app.call(path, args, { vault });
    return result;
  }

  it("releases the same-operation minted ref when the insert fails, and the error propagates", async () => {
    const storeSpy = vi.spyOn(vault, "store");
    const insertSpy = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("simulated insert failure");
    });

    await expect(
      call("addDataSource", {
        type: "notion",
        name: "Will Fail",
        apiKey: "plaintext-key",
      }),
    ).rejects.toThrow(/simulated insert failure/);

    insertSpy.mockRestore();

    // No row was written that could reference the minted ref.
    const rows = await db.select().from(dataSources);
    expect(rows.length).toBe(0);

    // The rollback released the ref this call minted (captured via the store spy,
    // since it never lands anywhere else once the insert fails).
    expect(storeSpy).toHaveBeenCalledTimes(1);
    const mintedRef = await storeSpy.mock.results[0]?.value;
    expect(isSecretRef(mintedRef)).toBe(true);
    expect(await vault.has(mintedRef)).toBe(false);
  });

  it("does not release the pre-existing ref on the row when a DIFFERENT field's update write fails (guardrail)", async () => {
    // Seed a row with a live connectionString ref via a successful addDataSource.
    const { id } = (await call("addDataSource", {
      type: "postgres",
      name: "Seed",
      connectionString: "postgres://seed",
    })) as { id: string };

    const before = await db.select().from(dataSources);
    const priorConnectionStringRaw = (
      before[0]?.config as { connectionString?: unknown }
    ).connectionString;
    expect(isSecretRef(priorConnectionStringRaw)).toBe(true);
    const priorConnectionString = priorConnectionStringRaw as SecretRef;
    expect(await vault.has(priorConnectionString)).toBe(true);

    // Now update apiKey (a DIFFERENT field) and force the DB update to fail.
    // connectionString is left untouched — its pre-existing ref must survive.
    const updateSpy = vi.spyOn(db, "update").mockImplementationOnce(() => {
      throw new Error("simulated update failure");
    });

    await expect(
      call("updateDataSource", {
        id,
        apiKey: "new-api-key-plaintext",
      }),
    ).rejects.toThrow(/simulated update failure/);

    updateSpy.mockRestore();

    // Guardrail: the pre-existing connectionString ref is untouched by the failed
    // apiKey write — it must still be live.
    expect(await vault.has(priorConnectionString)).toBe(true);

    // The row itself was never updated (write failed before/at the DB call).
    const after = await db.select().from(dataSources);
    expect(
      (after[0]?.config as { connectionString?: string }).connectionString,
    ).toBe(priorConnectionString);
  });

  it("succeeds unchanged on the happy path: the minted ref persists and the row is written", async () => {
    const result = (await call("addDataSource", {
      type: "notion",
      name: "Happy Path",
      apiKey: "plaintext-key",
    })) as { id: string };

    const rows = await db.select().from(dataSources);
    expect(rows.length).toBe(1);
    const config = rows[0]?.config as { apiKey?: unknown };
    expect(isSecretRef(config.apiKey)).toBe(true);
    expect(await vault.has(config.apiKey as SecretRef)).toBe(true);
    expect(rows[0]?.id).toBe(result.id);
  });
});
