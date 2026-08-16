/**
 * Tests for the privacy-floor write boundary in app-artifacts.
 *
 * Privacy floor: any DataFrameAnalysis written through putDataFrameEntry or
 * updateDataFrameEntry lands in the artifact DB with zero raw sampleValues.
 * The invariant is structural — it cannot be broken by the caller passing
 * sampleValues, because the boundary strips them before every write.
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

const { dataFrames, dataSources, dataTables, dashboards } = schema;

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

  it("rejects a malformed DataFrame entry before persistence", async () => {
    await expect(
      call("putDataFrameEntry", {
        entry: {
          ...makeDataFrameEntry(crypto.randomUUID()),
          storage: "s3",
        },
      }),
    ).rejects.toThrow();
    expect(await db.select().from(dataFrames)).toEqual([]);
  });

  it("rejects malformed DataFrame updates without changing the row", async () => {
    const id = crypto.randomUUID();
    await call("putDataFrameEntry", { entry: makeDataFrameEntry(id) });

    await expect(
      call("updateDataFrameEntry", { id, updates: { name: 42 } }),
    ).rejects.toThrow();
    expect((await db.select().from(dataFrames))[0]?.name).toBe("Test Frame");
  });

  it("rejects a malformed insight exclusion list at the RPC boundary", async () => {
    await expect(
      call("listInsights", { excludeIds: [crypto.randomUUID(), 42] }),
    ).rejects.toThrow();
  });

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

  it("rejects DataFrame updates and removals whose id does not exist", async () => {
    const missingId = crypto.randomUUID();

    await expect(
      call("updateDataFrameEntry", {
        id: missingId,
        updates: { name: "Nowhere" },
      }),
    ).rejects.toThrow(`Data frame ${missingId} not found`);
    await expect(
      call("removeDataFrameEntry", { id: missingId }),
    ).rejects.toThrow(`Data frame ${missingId} not found`);
  });

  it("fails closed when reading malformed DataTable structured state", async () => {
    const sourceId = crypto.randomUUID();
    const tableId = crypto.randomUUID();
    await db.insert(dataSources).values({
      id: sourceId,
      name: "Source",
      kind: "csv",
      storage: "live",
      config: {},
      createdBy: { kind: "user" },
    });
    await db.insert(dataTables).values({
      id: tableId,
      dataSourceId: sourceId,
      name: "Corrupt",
      table: "corrupt.csv",
      fields: {},
      metrics: [],
    });

    await expect(call("getDataTable", { id: tableId })).rejects.toThrow(
      /Data table .*invalid.*fields.*array/i,
    );
  });

  it("fails closed when reading malformed Dashboard structured state", async () => {
    const dashboardId = crypto.randomUUID();
    await db.insert(dashboards).values({
      id: dashboardId,
      name: "Corrupt",
      layout: {},
      createdBy: { kind: "user" },
    });

    await expect(call("getDashboard", { id: dashboardId })).rejects.toThrow(
      /Dashboard .*invalid.*layout.*array/i,
    );
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
