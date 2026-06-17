/**
 * Command vocabulary tests.
 *
 * These exercise the vocabulary THROUGH the real engine: a batch of typed
 * commands (built with `cmd(...)`) dispatched by `@wystack/server`'s
 * `applyCommands` against a real artifact DB. They assert the contracts the
 * spec freezes — atomicity of GetOrCreateDataSource, batch atomicity with the
 * client-id invariant, each command mapping to the right write, mid-batch
 * rollback, and preview persisting nothing.
 *
 * Covers: Insight (incl. Insight-on-Insight composition and cycle rejection),
 * SelectFields, SetInsightFilter/Sort, AddJoin/UpdateJoin/RemoveJoin,
 * Visualization (CreateVisualization, SetChartType, SetChartEncoding), Dashboard
 * (CreateDashboard, AddDashboardItem, UpdateDashboardItem, SetDashboardLayout,
 * RemoveDashboardItem), DeleteNode, extended RenameNode, and AddField/UpdateField
 * on Insight nodes.
 */
import { openArtifactDb, schema } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  isSecretRef,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { createWyStack, type WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { functions } from "../functions";
import { cmd } from "./commands";

/** Compose a SecretVault backed by TestBackend. ONLY for test setup. */
function makeTestVault(): SecretVault {
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend(), { fallback: true });
  registry.setClassDefault("connector-key", "test");
  return new SecretVault(registry, new InMemoryMappingStore());
}

const { dataSources, dataTables, insights, visualizations, dashboards } =
  schema;

describe("command vocabulary", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  let vault: SecretVault;
  // applyCommands is registered alongside query/mutation on @wystack/server;
  // import lazily so the test reads top-down with the engine right where used.
  let applyCommands: typeof import("@wystack/server").applyCommands;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-cmd-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await createWyStack({ db, functions });
    vault = makeTestVault();
    ({ applyCommands } = await import("@wystack/server"));
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function id(): string {
    return crypto.randomUUID();
  }

  // Inject the vault via applyCommands' context — mirrors how the server seam
  // passes ctx.vault to handlers. Credential-bearing commands require it (the
  // server fails closed without a vault); credential-free batches ignore it.
  async function commit(...commands: ReturnType<typeof cmd>[]) {
    return applyCommands(app, commands, { mode: "commit", context: { vault } });
  }

  // Assertion reads go through the raw Drizzle handle and filter in JS — the
  // server package has no direct `drizzle-orm` dep for a `where()` operator,
  // and these test DBs hold a handful of rows.
  async function sourcesById(sourceId: string) {
    const rows = await db.select().from(dataSources);
    return rows.filter((r) => r.id === sourceId);
  }
  async function sourcesByKind(kind: string) {
    const rows = await db.select().from(dataSources);
    return rows.filter((r) => r.kind === kind);
  }
  async function allSources() {
    return db.select().from(dataSources);
  }
  async function tablesById(tableId: string) {
    const rows = await db.select().from(dataTables);
    return rows.filter((r) => r.id === tableId);
  }
  async function insightsById(insightId: string) {
    const rows = await db.select().from(insights);
    return rows.filter((r) => r.id === insightId);
  }
  async function vizsById(vizId: string) {
    const rows = await db.select().from(visualizations);
    return rows.filter((r) => r.id === vizId);
  }
  async function dashboardsById(dashId: string) {
    const rows = await db.select().from(dashboards);
    return rows.filter((r) => r.id === dashId);
  }

  /** Create a DataSource + DataTable in one batch, returning both ids. */
  async function makeTable(): Promise<{ sourceId: string; tableId: string }> {
    const sourceId = id();
    const tableId = id();
    await commit(
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "T",
        table: "t.csv",
      }),
    );
    return { sourceId, tableId };
  }

  describe("GetOrCreateDataSource (the reference atomic command)", () => {
    // Note on the defect & why these assert what they do: the original bug (PR
    // #46 Greptile P1) was two concurrent ingests both passing a `kind`-keyed
    // existence check and both inserting. PGLite is a single-connection WASM
    // Postgres, so `applyCommands` batches here serialize — they can't reproduce
    // a true read-read-write-write interleaving. The fix is therefore tested by
    // its STRUCTURE, not by racing: idempotency is keyed on the PRIMARY KEY (not
    // `kind`), and the PK is the hard backstop that makes a double-insert
    // impossible regardless of interleaving. The two tests below pin exactly
    // that — the kind-keyed racy version would FAIL the first (it returns the
    // existing row for a second, distinct id of the same kind) and could never
    // satisfy the PK guarantee the second asserts.

    it("should key idempotency on the id, not the kind (two ids of one kind = two sources)", async () => {
      const idA = id();
      const idB = id();
      await commit(
        cmd("GetOrCreateDataSource", { id: idA, type: "local", name: "A" }),
      );
      await commit(
        cmd("GetOrCreateDataSource", { id: idB, type: "local", name: "B" }),
      );

      // The racy kind-keyed version would return idA for the second call and
      // leave ONE row. The id-keyed fix keeps them distinct: get-or-create is a
      // PK upsert, so two different ids are two sources even with one kind.
      expect(await sourcesById(idA)).toHaveLength(1);
      expect(await sourcesById(idB)).toHaveLength(1);
      expect(await sourcesByKind("local")).toHaveLength(2);
    });

    it("should make a same-id double-insert impossible — the PK backstop (no double-insert defect)", async () => {
      const sourceId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "local", name: "First" }),
      );

      // A second create with the SAME client id cannot persist a second row —
      // the primary key rejects it. This is the structural guarantee the racy
      // kind-keyed check lacked: even if two ingests both decide to insert, the
      // PK admits exactly one. The losing batch throws and rolls back.
      await expect(
        commit(
          cmd("CreateDataSource", {
            id: sourceId,
            type: "local",
            name: "Second",
          }),
        ),
      ).rejects.toThrow();

      const rows = await sourcesById(sourceId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe("First");
    });

    it("should return the existing row on a second get-or-create with the same id", async () => {
      const sourceId = id();
      await commit(
        cmd("GetOrCreateDataSource", {
          id: sourceId,
          type: "local",
          name: "Local Files",
        }),
      );
      const second = await commit(
        cmd("GetOrCreateDataSource", {
          id: sourceId,
          type: "local",
          name: "Ignored Second Name",
        }),
      );
      expect(second.results[0]?.value).toEqual({ id: sourceId });

      const rows = await allSources();
      expect(rows).toHaveLength(1);
      // The original name is preserved — get-or-create does not overwrite.
      expect(rows[0]?.name).toBe("Local Files");
    });

    it("should ignore the type arg on a second get-or-create with the same id (existing row wins)", async () => {
      const sourceId = id();
      await commit(
        cmd("GetOrCreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      );
      // The canonical caller derives id FROM type, so this mismatch can't
      // happen there — but the command is callable by any producer. Pin the
      // chosen semantics (existing row wins, type silently ignored) so they
      // can't drift unnoticed. Conflict semantics are a Spec Open Q.
      await commit(
        cmd("GetOrCreateDataSource", {
          id: sourceId,
          type: "notion",
          name: "N",
        }),
      );
      const rows = await sourcesById(sourceId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe("csv");
    });
  });

  describe("client-id invariant across a batch", () => {
    it("should create a DataSource then a DataTable referencing it atomically", async () => {
      const sourceId = id();
      const tableId = id();

      const result = await commit(
        cmd("CreateDataSource", {
          id: sourceId,
          type: "csv",
          name: "Sales CSV",
        }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "Q1",
          table: "q1.csv",
        }),
      );
      expect(result.mode).toBe("commit");
      expect(result.commands).toHaveLength(2);

      const source = await sourcesById(sourceId);
      const table = await tablesById(tableId);
      expect(source).toHaveLength(1);
      expect(table).toHaveLength(1);
      expect(table[0]?.dataSourceId).toBe(sourceId);
    });
  });

  describe("each command maps to the right write", () => {
    it("should write kind/name/config for CreateDataSource", async () => {
      const sourceId = id();
      await commit(
        cmd("CreateDataSource", {
          id: sourceId,
          type: "notion",
          name: "Notion",
          apiKey: "secret-key",
        }),
      );
      const [row] = await sourcesById(sourceId);
      expect(row?.kind).toBe("notion");
      expect(row?.name).toBe("Notion");
      // config.apiKey holds a SecretRef, NOT the plaintext — the credential was
      // stored in the vault and only the opaque ref is persisted.
      const stored = (row?.config as { apiKey?: string }).apiKey;
      expect(isSecretRef(stored)).toBe(true);
      expect(stored).not.toBe("secret-key");
      // The ref resolves back to the original plaintext via the vault.
      expect(await vault.has(stored as never)).toBe(true);
    });

    it("should replace only config (not name) for SetDataSourceConfig, decomposed from updateDataSource", async () => {
      const sourceId = id();
      // Create first, then read the original ref BEFORE the config update so the
      // replacement is provable (not just "the final value is a ref").
      await commit(
        cmd("CreateDataSource", {
          id: sourceId,
          type: "notion",
          name: "Original",
          apiKey: "old",
        }),
      );
      const refBefore = (
        (await sourcesById(sourceId))[0]?.config as { apiKey?: string }
      ).apiKey;
      expect(isSecretRef(refBefore)).toBe(true);

      await commit(cmd("SetDataSourceConfig", { id: sourceId, apiKey: "new" }));

      const [row] = await sourcesById(sourceId);
      const refAfter = (row?.config as { apiKey?: string }).apiKey;
      // A FRESH ref replaced the old one — prove the binding actually changed.
      expect(isSecretRef(refAfter)).toBe(true);
      expect(refAfter).not.toBe(refBefore);
      expect(refAfter).not.toBe("new");
      expect(row?.name).toBe("Original");
    });

    it("should rename without touching config for RenameNode, decomposed from updateDataSource", async () => {
      const sourceId = id();
      // Read the credential ref BEFORE the rename so "config untouched" is
      // provable: the ref must be byte-identical after RenameNode.
      await commit(
        cmd("CreateDataSource", {
          id: sourceId,
          type: "notion",
          name: "Original",
          apiKey: "keep",
        }),
      );
      const refBefore = (
        (await sourcesById(sourceId))[0]?.config as { apiKey?: string }
      ).apiKey;
      expect(isSecretRef(refBefore)).toBe(true);

      await commit(cmd("RenameNode", { id: sourceId, name: "Renamed" }));

      const [row] = await sourcesById(sourceId);
      expect(row?.name).toBe("Renamed");
      // RenameNode does not touch config: the SAME ref is preserved unchanged.
      const refAfter = (row?.config as { apiKey?: string }).apiKey;
      expect(refAfter).toBe(refBefore);
    });

    it("should report the resolved target on the RenameNode result so the preview can read it (not re-derive)", async () => {
      // The handler probes dataTables → dataSources → insights and renames the
      // first hit. Its result must carry which artifact it resolved to — this is
      // the contract the preview builder consumes instead of re-deriving kind.
      const sourceId = id();
      const tableId = id();
      const result = await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("RenameNode", { id: sourceId, name: "RenamedSource" }),
        cmd("RenameNode", { id: tableId, name: "RenamedTable" }),
      );

      // results[2] is the source rename, results[3] the table rename (positional).
      expect(result.results[2]!.value).toMatchObject({
        renamed: { kind: "dataSource", id: sourceId },
      });
      expect(result.results[3]!.value).toMatchObject({
        renamed: { kind: "dataTable", id: tableId },
      });
    });

    it("should edit the jsonb array via AddField then RemoveField, decomposed from patchDataTableArray", async () => {
      const sourceId = id();
      const tableId = id();
      const fieldId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("AddField", {
          nodeId: tableId,
          field: {
            id: fieldId,
            name: "Amount",
            tableId,
            columnName: "amount",
            type: "number",
          },
        }),
      );

      let [row] = await tablesById(tableId);
      expect((row?.fields as { id: string }[]).map((f) => f.id)).toEqual([
        fieldId,
      ]);

      await commit(cmd("RemoveField", { nodeId: tableId, fieldId }));
      [row] = await tablesById(tableId);
      expect(row?.fields).toEqual([]);
    });

    it("should reject a duplicate field id in AddField (no illegal two-items-one-id state)", async () => {
      const sourceId = id();
      const tableId = id();
      const fieldId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("AddField", {
          nodeId: tableId,
          field: {
            id: fieldId,
            name: "Amount",
            tableId,
            columnName: "amount",
            type: "number",
          },
        }),
      );

      // Second Add of the same id must throw (and roll back), not append a dup.
      await expect(
        commit(
          cmd("AddField", {
            nodeId: tableId,
            field: {
              id: fieldId,
              name: "Amount again",
              tableId,
              columnName: "amount",
              type: "number",
            },
          }),
        ),
      ).rejects.toThrow(/already exists/);

      const [row] = await tablesById(tableId);
      expect((row?.fields as { id: string }[]).map((f) => f.id)).toEqual([
        fieldId,
      ]);
    });

    it("should stamp dataFrameId and lastFetchedAt for RefreshDataTable", async () => {
      const sourceId = id();
      const tableId = id();
      const frameId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("RefreshDataTable", { id: tableId, dataFrameId: frameId }),
      );
      const [row] = await tablesById(tableId);
      expect(row?.dataFrameId).toBe(frameId);
      expect(row?.lastFetchedAt).toBeInstanceOf(Date);
    });

    it("should replace the source schema slice for SetDataTableSchema", async () => {
      const sourceId = id();
      const tableId = id();
      const sourceSchema = { columns: [{ name: "amount", type: "number" }] };
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("SetDataTableSchema", {
          id: tableId,
          sourceSchema: sourceSchema as never,
        }),
      );
      const [row] = await tablesById(tableId);
      expect(row?.sourceSchema).toEqual(sourceSchema);
    });

    it("should merge updates by id without rebinding the id for UpdateField", async () => {
      const sourceId = id();
      const tableId = id();
      const fieldId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("AddField", {
          nodeId: tableId,
          field: {
            id: fieldId,
            name: "Amount",
            tableId,
            columnName: "amount",
            type: "number",
          },
        }),
        // A stray `id` in updates must NOT rebind the field — pinned id wins.
        cmd("UpdateField", {
          nodeId: tableId,
          fieldId,
          updates: { name: "Total", id: id() } as never,
        }),
      );
      const [row] = await tablesById(tableId);
      const fields = row?.fields as { id: string; name: string }[];
      expect(fields).toHaveLength(1);
      expect(fields[0]?.id).toBe(fieldId);
      expect(fields[0]?.name).toBe("Total");
    });

    it("should merge updates by id for UpdateMetric", async () => {
      const sourceId = id();
      const tableId = id();
      const metricId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("AddMetric", {
          nodeId: tableId,
          metric: {
            id: metricId,
            name: "Sum",
            expression: "sum(amount)",
          } as never,
        }),
        cmd("UpdateMetric", {
          nodeId: tableId,
          metricId,
          updates: { name: "Total Sum" } as never,
        }),
      );
      const [row] = await tablesById(tableId);
      const metrics = row?.metrics as { id: string; name: string }[];
      expect(metrics).toHaveLength(1);
      expect(metrics[0]?.name).toBe("Total Sum");
    });

    it("should remove a metric by id for RemoveMetric", async () => {
      const sourceId = id();
      const tableId = id();
      const metricId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("AddMetric", {
          nodeId: tableId,
          metric: {
            id: metricId,
            name: "Sum",
            expression: "sum(amount)",
          } as never,
        }),
      );

      await commit(cmd("RemoveMetric", { nodeId: tableId, metricId }));
      const [row] = await tablesById(tableId);
      expect(row?.metrics).toEqual([]);
    });

    it("should reject a duplicate metric id in AddMetric (no illegal two-items-one-id state)", async () => {
      const sourceId = id();
      const tableId = id();
      const metricId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
        cmd("AddMetric", {
          nodeId: tableId,
          metric: { id: metricId, name: "Sum" } as never,
        }),
      );

      await expect(
        commit(
          cmd("AddMetric", {
            nodeId: tableId,
            metric: { id: metricId, name: "Sum again" } as never,
          }),
        ),
      ).rejects.toThrow(/already exists/);

      const [row] = await tablesById(tableId);
      expect((row?.metrics as { id: string }[]).map((m) => m.id)).toEqual([
        metricId,
      ]);
    });

    it("should throw on a missing id for SetDataTableSchema (no silent no-op)", async () => {
      await expect(
        commit(
          cmd("SetDataTableSchema", { id: id(), sourceSchema: {} as never }),
        ),
      ).rejects.toThrow(/not found/);
    });

    it("should throw on a missing id for RefreshDataTable (no silent no-op)", async () => {
      await expect(
        commit(cmd("RefreshDataTable", { id: id(), dataFrameId: id() })),
      ).rejects.toThrow(/not found/);
    });

    it("should throw on a missing id for RenameNode (no silent no-op)", async () => {
      await expect(
        commit(cmd("RenameNode", { id: id(), name: "X" })),
      ).rejects.toThrow(/not found/);
    });

    it("should throw on a missing id for SetDataSourceConfig (no silent no-op)", async () => {
      await expect(
        commit(cmd("SetDataSourceConfig", { id: id(), apiKey: "x" })),
      ).rejects.toThrow(/not found/);
    });

    it("SetDataSourceConfig sink guard: extra.apiKey throws and leaves config unchanged", async () => {
      const sourceId = id();
      await commit(
        cmd("CreateDataSource", {
          id: sourceId,
          type: "notion",
          name: "N",
          apiKey: "original",
        }),
      );
      const refBefore = (
        (await sourcesById(sourceId))[0]?.config as { apiKey?: string }
      ).apiKey;
      // Attempt to smuggle a credential via extra — must throw.
      await expect(
        commit(
          cmd("SetDataSourceConfig", {
            id: sourceId,
            extra: { apiKey: "smuggled-plaintext" } as Record<string, unknown>,
          }),
        ),
      ).rejects.toThrow(/apiKey.*connectionString.*typed credential/i);
      // Config must be unchanged — the original ref is still there.
      const refAfter = (
        (await sourcesById(sourceId))[0]?.config as { apiKey?: string }
      ).apiKey;
      expect(refAfter).toBe(refBefore);
    });

    it("SetDataSourceConfig sink guard: extra.connectionString throws and leaves config unchanged", async () => {
      const sourceId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "postgres", name: "P" }),
      );
      await expect(
        commit(
          cmd("SetDataSourceConfig", {
            id: sourceId,
            extra: { connectionString: "postgresql://plaintext" } as Record<
              string,
              unknown
            >,
          }),
        ),
      ).rejects.toThrow(/apiKey.*connectionString.*typed credential/i);
    });

    it("SetDataSourceConfig extra: non-credential settings round-trip through config", async () => {
      const sourceId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "postgres", name: "P" }),
      );
      await commit(
        cmd("SetDataSourceConfig", {
          id: sourceId,
          extra: { database: "analytics", schema: "public" } as Record<
            string,
            unknown
          >,
        }),
      );
      const [row] = await sourcesById(sourceId);
      const stored = row?.config as Record<string, unknown>;
      // Non-credential keys persist as-is.
      expect(stored["database"]).toBe("analytics");
      expect(stored["schema"]).toBe("public");
      // Credential slots remain absent (never set).
      expect(stored["apiKey"]).toBeUndefined();
      expect(stored["connectionString"]).toBeUndefined();
    });

    it("should throw on UpdateField with a missing fieldId", async () => {
      const sourceId = id();
      const tableId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
      );
      await expect(
        commit(
          cmd("UpdateField", {
            nodeId: tableId,
            fieldId: id(),
            updates: { name: "X" } as never,
          }),
        ),
      ).rejects.toThrow(/not found/);
    });

    it("should throw on UpdateMetric with a missing metricId", async () => {
      const sourceId = id();
      const tableId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
        }),
      );
      await expect(
        commit(
          cmd("UpdateMetric", {
            nodeId: tableId,
            metricId: id(),
            updates: { name: "X" } as never,
          }),
        ),
      ).rejects.toThrow(/not found/);
    });
  });

  describe("atomicity", () => {
    it("should roll back the whole batch when a mid-batch command fails", async () => {
      const sourceId = id();
      const tableId = id();

      await expect(
        commit(
          cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
          cmd("CreateDataTable", {
            id: tableId,
            dataSourceId: sourceId,
            name: "T",
            table: "t.csv",
          }),
          // Fails: removing a field that does not exist throws → rolls back ALL.
          cmd("RemoveField", { nodeId: tableId, fieldId: id() }),
        ),
      ).rejects.toThrow();

      // Nothing from the batch persisted — the earlier inserts rolled back too.
      const sources = await sourcesById(sourceId);
      const tables = await tablesById(tableId);
      expect(sources).toHaveLength(0);
      expect(tables).toHaveLength(0);
    });
  });

  describe("preview", () => {
    it("should persist nothing for a preview batch", async () => {
      const sourceId = id();
      const result = await applyCommands(
        app,
        [cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" })],
        { mode: "preview" },
      );
      expect(result.mode).toBe("preview");
      // It WOULD have written the data_sources table — pin the table name so a
      // preview writing the wrong table can't satisfy this.
      expect(result.tablesWritten.has("data_sources")).toBe(true);

      const rows = await sourcesById(sourceId);
      expect(rows).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Insight commands
  // ===========================================================================

  describe("CreateInsight", () => {
    it("should create an insight over a DataTable source", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "Revenue by Region",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );
      const rows = await insightsById(insightId);
      expect(rows).toHaveLength(1);
      const def = rows[0]?.definition as {
        baseTableId: string;
        source: { sourceType: string; sourceId: string };
      };
      // baseTableId mirrors source.sourceId on every write.
      expect(def.baseTableId).toBe(tableId);
      // New polymorphic source field.
      expect(def.source).toEqual({
        sourceType: "dataTable",
        sourceId: tableId,
      });
    });

    it("should batch CreateInsight + CreateVisualization in one atomic envelope (client-id invariant)", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      const vizId = id();
      const result = await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "Trend",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("CreateVisualization", {
          id: vizId,
          name: "Trend Chart",
          insightId,
          visualizationType: "line",
          spec: {},
        }),
      );
      expect(result.mode).toBe("commit");
      expect(result.commands).toHaveLength(2);

      const iRows = await insightsById(insightId);
      const vRows = await vizsById(vizId);
      expect(iRows).toHaveLength(1);
      expect(vRows).toHaveLength(1);
      expect(vRows[0]?.insightId).toBe(insightId);
    });

    it("should reject a self-referential insight source (client-supplied id == sourceId)", async () => {
      // CreateInsight mints its own id, so a caller can name itself as its
      // insight source — a 1-cycle that bypasses SetInsightSource's cycle guard.
      const insightId = id();
      await expect(
        commit(
          cmd("CreateInsight", {
            id: insightId,
            name: "Self",
            source: { sourceType: "insight", sourceId: insightId },
          }),
        ),
      ).rejects.toThrow(/cycle/);
      expect(await insightsById(insightId)).toHaveLength(0);
    });

    it("should reject a non-existent insight source (no dangling reference persisted)", async () => {
      const insightId = id();
      await expect(
        commit(
          cmd("CreateInsight", {
            id: insightId,
            name: "Dangling",
            source: { sourceType: "insight", sourceId: id() },
          }),
        ),
      ).rejects.toThrow(/not found/);
      expect(await insightsById(insightId)).toHaveLength(0);
    });
  });

  describe("SetInsightSource (Insight-on-Insight composition + cycle rejection)", () => {
    it("should re-point an Insight's source to another Insight's DataFrame", async () => {
      const { tableId } = await makeTable();
      const baseInsightId = id();
      const derivedInsightId = id();
      await commit(
        cmd("CreateInsight", {
          id: baseInsightId,
          name: "Base",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("CreateInsight", {
          id: derivedInsightId,
          name: "Derived",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );

      await commit(
        cmd("SetInsightSource", {
          id: derivedInsightId,
          source: { sourceType: "insight", sourceId: baseInsightId },
        }),
      );

      const rows = await insightsById(derivedInsightId);
      const def = rows[0]?.definition as {
        source: { sourceType: string; sourceId: string };
      };
      expect(def.source).toEqual({
        sourceType: "insight",
        sourceId: baseInsightId,
      });
    });

    it("should reject a direct self-cycle (insight sourcing itself)", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "Self",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );

      await expect(
        commit(
          cmd("SetInsightSource", {
            id: insightId,
            source: { sourceType: "insight", sourceId: insightId },
          }),
        ),
      ).rejects.toThrow(/cycle/);
    });

    it("should reject a transitive cycle (A → B, then B → A)", async () => {
      const { tableId } = await makeTable();
      const aId = id();
      const bId = id();
      await commit(
        cmd("CreateInsight", {
          id: aId,
          name: "A",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("CreateInsight", {
          id: bId,
          name: "B",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );

      // A now depends on B.
      await commit(
        cmd("SetInsightSource", {
          id: aId,
          source: { sourceType: "insight", sourceId: bId },
        }),
      );

      // Making B depend on A would close the cycle: A → B → A.
      await expect(
        commit(
          cmd("SetInsightSource", {
            id: bId,
            source: { sourceType: "insight", sourceId: aId },
          }),
        ),
      ).rejects.toThrow(/cycle/);

      // A's source should still be B (the rollback worked).
      const aRows = await insightsById(aId);
      const def = aRows[0]?.definition as { source: { sourceId: string } };
      expect(def.source.sourceId).toBe(bId);
    });

    it("should throw for SetInsightSource on a missing insight (no silent no-op)", async () => {
      const { tableId } = await makeTable();
      await expect(
        commit(
          cmd("SetInsightSource", {
            id: id(),
            source: { sourceType: "dataTable", sourceId: tableId },
          }),
        ),
      ).rejects.toThrow(/not found/);
    });

    it("should reject a non-existent insight source (wouldCreateCycle treats missing as leaf — guard with existence check)", async () => {
      // The source is JSON, not an FK, and wouldCreateCycle returns false for a
      // missing source row. Without an existence check a dangling sourceId would
      // persist and the command would report success.
      const { tableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "Derived",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );
      const missingSourceId = id();
      await expect(
        commit(
          cmd("SetInsightSource", {
            id: insightId,
            source: { sourceType: "insight", sourceId: missingSourceId },
          }),
        ),
      ).rejects.toThrow(/not found/);

      // The original dataTable source must be intact (the write rolled back).
      const rows = await insightsById(insightId);
      const def = rows[0]?.definition as { source: { sourceId: string } };
      expect(def.source.sourceId).toBe(tableId);
    });
  });

  describe("SelectFields", () => {
    it("should replace the selected fields set with replace-all semantics", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      const fieldA = id();
      const fieldB = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
          selectedFields: [fieldA],
        }),
      );

      await commit(
        cmd("SelectFields", { id: insightId, fieldIds: [fieldA, fieldB] }),
      );
      const rows = await insightsById(insightId);
      const def = rows[0]?.definition as { selectedFields: string[] };
      expect(def.selectedFields).toEqual([fieldA, fieldB]);

      // Replace-all: supplying an empty set clears all fields.
      await commit(cmd("SelectFields", { id: insightId, fieldIds: [] }));
      const rows2 = await insightsById(insightId);
      const def2 = rows2[0]?.definition as { selectedFields: string[] };
      expect(def2.selectedFields).toEqual([]);
    });
  });

  describe("SetInsightFilter", () => {
    it("should replace filters with tagged-union operands", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );

      const filters = [
        {
          field: "region",
          operator: "eq" as const,
          value: { kind: "value" as const, v: "EMEA" },
        },
      ];
      await commit(cmd("SetInsightFilter", { id: insightId, filters }));
      const rows = await insightsById(insightId);
      const def = rows[0]?.definition as { filters: typeof filters };
      expect(def.filters).toEqual(filters);
    });

    it("should replace filters with a late-bound operand (category handle)", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );

      // The agent emits the same command verb; the value is a late-bound ref
      // because the egress gate withheld the literal.
      const filters = [
        {
          field: "customer_id",
          operator: "eq" as const,
          value: {
            kind: "lateBound" as const,
            ref: { type: "category" as const, handle: "cat_abc123" },
          },
        },
      ];
      await commit(cmd("SetInsightFilter", { id: insightId, filters }));
      const rows = await insightsById(insightId);
      const def = rows[0]?.definition as { filters: typeof filters };
      // The tagged-union discriminant must be stored verbatim — the command
      // is a passthrough store; validation of handle existence is bind-time.
      expect(def.filters[0]?.value.kind).toBe("lateBound");
    });
  });

  describe("SetInsightSort", () => {
    it("should replace the sort order (replace-all semantics)", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );

      const sorts = [{ field: "amount", direction: "desc" as const }];
      await commit(cmd("SetInsightSort", { id: insightId, sorts }));
      const rows = await insightsById(insightId);
      const def = rows[0]?.definition as { sorts: typeof sorts };
      expect(def.sorts).toEqual(sorts);
    });
  });

  describe("AddJoin / UpdateJoin / RemoveJoin", () => {
    it("should add a join and then remove it by index", async () => {
      const { tableId } = await makeTable();
      const { tableId: rightTableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );

      const join = {
        type: "inner" as const,
        rightTableId,
        leftKey: "user_id",
        rightKey: "id",
      };
      await commit(cmd("AddJoin", { id: insightId, join }));
      const rows = await insightsById(insightId);
      const def = rows[0]?.definition as { joins: (typeof join)[] };
      expect(def.joins).toHaveLength(1);
      expect(def.joins[0]).toEqual(join);

      // Remove the join by index.
      await commit(cmd("RemoveJoin", { id: insightId, joinIndex: 0 }));
      const rows2 = await insightsById(insightId);
      const def2 = rows2[0]?.definition as { joins: unknown[] };
      expect(def2.joins).toHaveLength(0);
    });

    it("should reject an AddJoin with a malformed shape or a dangling rightTableId (validate before persisting)", async () => {
      // Regression: AddJoin stored the raw JSON join verbatim — a missing/bogus
      // type, a non-string rightTableId, or a rightTableId that resolves to no
      // DataTable would persist into definition.joins. Downstream SQL assembly
      // silently SKIPS an unresolved join table, producing wrong results instead
      // of rejecting the command. The fix validates shape + FK at the write boundary.
      const { tableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );

      // Bad join type.
      await expect(
        commit(
          cmd("AddJoin", {
            id: insightId,
            join: {
              type: "cross",
              rightTableId: tableId,
              leftKey: "a",
              rightKey: "b",
            } as never,
          }),
        ),
      ).rejects.toThrow(/type/);

      // Dangling rightTableId (well-formed shape, but no such DataTable).
      await expect(
        commit(
          cmd("AddJoin", {
            id: insightId,
            join: {
              type: "inner",
              rightTableId: id(),
              leftKey: "a",
              rightKey: "b",
            },
          }),
        ),
      ).rejects.toThrow(/does not resolve to a DataTable/);

      // Nothing persisted from either rejected command.
      const rows = await insightsById(insightId);
      const def = rows[0]?.definition as { joins?: unknown[] };
      expect(def.joins ?? []).toHaveLength(0);
    });

    it("should update a join at the given index without clobbering other keys", async () => {
      const { tableId } = await makeTable();
      const { tableId: rightTableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("AddJoin", {
          id: insightId,
          join: {
            type: "inner",
            rightTableId,
            leftKey: "user_id",
            rightKey: "id",
          },
        }),
      );

      await commit(
        cmd("UpdateJoin", {
          id: insightId,
          joinIndex: 0,
          updates: { type: "left" },
        }),
      );
      const rows = await insightsById(insightId);
      const def = rows[0]?.definition as {
        joins: { type: string; rightTableId: string }[];
      };
      expect(def.joins[0]?.type).toBe("left");
      // Other keys preserved.
      expect(def.joins[0]?.rightTableId).toBe(rightTableId);
    });

    it("should throw on UpdateJoin with a missing index (no silent no-op)", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );
      await expect(
        commit(
          cmd("UpdateJoin", {
            id: insightId,
            joinIndex: 5,
            updates: { type: "left" },
          }),
        ),
      ).rejects.toThrow(/not found/);
    });

    it("should throw on RemoveJoin with a missing index (no silent no-op)", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );
      await expect(
        commit(cmd("RemoveJoin", { id: insightId, joinIndex: 0 })),
      ).rejects.toThrow(/not found/);
    });

    it("should reject a malformed joinIndex for UpdateJoin (null / float / string are not integers)", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );
      await expect(
        commit(
          cmd("UpdateJoin", {
            id: insightId,
            joinIndex: null as unknown as number,
            updates: { type: "left" },
          }),
        ),
      ).rejects.toThrow(/non-negative integer/);
      await expect(
        commit(
          cmd("UpdateJoin", {
            id: insightId,
            joinIndex: 0.5,
            updates: { type: "left" },
          }),
        ),
      ).rejects.toThrow(/non-negative integer/);
    });

    it("should reject a malformed joinIndex for RemoveJoin (null / float / string are not integers)", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );
      await expect(
        commit(
          cmd("RemoveJoin", {
            id: insightId,
            joinIndex: null as unknown as number,
          }),
        ),
      ).rejects.toThrow(/non-negative integer/);
      await expect(
        commit(
          cmd("RemoveJoin", {
            id: insightId,
            joinIndex: "0" as unknown as number,
          }),
        ),
      ).rejects.toThrow(/non-negative integer/);
    });
  });

  describe("AddField / RemoveField on Insight node (selectedFields membership)", () => {
    it("should add the field id to selectedFields (the array the read path surfaces), not a phantom definition.fields", async () => {
      // Regression: AddField on an Insight wrote `definition.fields` (an array of
      // Field objects), but rowToInsight surfaces `definition.selectedFields`
      // (UUID[]) and ignores `definition.fields`. The selection reported success
      // while the read path returned the old list. The fix routes an Insight field
      // edit to selectedFields membership (mirrors patchInsightDefinition.addField).
      const { tableId } = await makeTable();
      const insightId = id();
      const fieldId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );

      await commit(
        cmd("AddField", {
          nodeId: insightId,
          field: {
            id: fieldId,
            name: "Revenue",
            tableId,
            columnName: "revenue",
            type: "number",
          },
        }),
      );

      const rows = await insightsById(insightId);
      const def = rows[0]?.definition as {
        selectedFields: string[];
        fields?: unknown;
      };
      // The id lands in selectedFields — the array the read path reads.
      expect(def.selectedFields).toEqual([fieldId]);
      // No phantom `fields` key the read path would ignore.
      expect(def.fields).toBeUndefined();

      // RemoveField drops the id from selectedFields.
      await commit(cmd("RemoveField", { nodeId: insightId, fieldId }));
      const rows2 = await insightsById(insightId);
      const def2 = rows2[0]?.definition as { selectedFields: string[] };
      expect(def2.selectedFields).toEqual([]);
    });

    it("should reject UpdateField on an Insight node (a referenced field has no editable definition on the Insight)", async () => {
      // A field on an Insight is a reference (an id in selectedFields), not an
      // owned Field object — nothing to edit. The old code silently wrote a phantom
      // definition.fields the read path never reads, so the edit looked successful
      // but no-op'd. Reject loudly instead.
      const { tableId } = await makeTable();
      const insightId = id();
      const fieldId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("AddField", {
          nodeId: insightId,
          field: { id: fieldId, name: "Revenue", tableId, type: "number" },
        }),
      );

      await expect(
        commit(
          cmd("UpdateField", {
            nodeId: insightId,
            fieldId,
            updates: { name: "Net Revenue" },
          }),
        ),
      ).rejects.toThrow(/not supported on an Insight/);
    });

    it("should reject a duplicate field id on AddField for Insight node", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      const fieldId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("AddField", {
          nodeId: insightId,
          field: {
            id: fieldId,
            name: "X",
            tableId,
            columnName: "x",
            type: "string",
          },
        }),
      );

      await expect(
        commit(
          cmd("AddField", {
            nodeId: insightId,
            field: {
              id: fieldId,
              name: "X again",
              tableId,
              columnName: "x",
              type: "string",
            },
          }),
        ),
      ).rejects.toThrow(/already exists/);
    });
  });

  describe("AddMetric on Insight node — InsightMetric shape round-trip", () => {
    it("should store an InsightMetric (sourceTable) and round-trip through the read path", async () => {
      // Regression: AddMetric on an Insight was casting the incoming metric to the
      // DataTable Metric shape (tableId). The read path (requireInsightMetric in
      // app-artifacts.ts) enforces InsightMetric (sourceTable), so stored metrics
      // with only tableId would break source-table resolution on read. The fix
      // validates sourceTable at the write boundary (requireInsightMetricShape) —
      // same class as the CreateInsight.metrics fix in commit 72365b0.
      const { tableId } = await makeTable();
      const insightId = id();
      const metricId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "Revenue Insight",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );

      await commit(
        cmd("AddMetric", {
          nodeId: insightId,
          metric: {
            id: metricId,
            name: "Total Revenue",
            sourceTable: tableId,
            aggregation: "sum",
          },
        }),
      );

      const rows = await insightsById(insightId);
      const def = rows[0]?.definition as {
        metrics: {
          id: string;
          name: string;
          sourceTable: string;
          aggregation: string;
        }[];
      };
      expect(def.metrics).toHaveLength(1);
      const stored = def.metrics[0]!;
      // Read path (requireInsightMetric) requires all four fields — assert each:
      expect(stored.id).toBe(metricId);
      expect(stored.name).toBe("Total Revenue");
      expect(stored.sourceTable).toBe(tableId); // the field requireInsightMetric checks
      expect(stored.aggregation).toBe("sum");
    });

    it("should reject an AddMetric on an Insight that lacks sourceTable (DataTable Metric shape rejected at write boundary)", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );

      await expect(
        commit(
          cmd("AddMetric", {
            nodeId: insightId,
            // DataTable Metric shape — tableId instead of sourceTable — must be rejected.
            metric: {
              id: crypto.randomUUID(),
              name: "Sum",
              expression: "sum(amount)",
            } as never,
          }),
        ),
      ).rejects.toThrow(/sourceTable/);
    });
  });

  describe("UpdateMetric on Insight node — merged shape re-validated", () => {
    /** Seed an Insight carrying one valid InsightMetric; returns the ids. */
    async function makeInsightWithMetric() {
      const { tableId } = await makeTable();
      const insightId = id();
      const metricId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("AddMetric", {
          nodeId: insightId,
          metric: {
            id: metricId,
            name: "Total Revenue",
            sourceTable: tableId,
            aggregation: "sum",
          },
        }),
      );
      return { tableId, insightId, metricId };
    }

    it("should reject an update that corrupts sourceTable to null, leaving the stored metric unchanged", async () => {
      // Regression: the update path merged blind jsonb updates into a stored
      // InsightMetric without re-validating the result — `{ sourceTable: null }`
      // would persist a metric the read path (requireInsightMetric) rejects.
      const { tableId, insightId, metricId } = await makeInsightWithMetric();

      await expect(
        commit(
          cmd("UpdateMetric", {
            nodeId: insightId,
            metricId,
            updates: { sourceTable: null } as never,
          }),
        ),
      ).rejects.toThrow(/sourceTable/);

      // The stored metric must be untouched — no partial write before the throw.
      const rows = await insightsById(insightId);
      const def = rows[0]?.definition as {
        metrics: { id: string; sourceTable: string; aggregation: string }[];
      };
      expect(def.metrics).toHaveLength(1);
      expect(def.metrics[0]?.sourceTable).toBe(tableId);
      expect(def.metrics[0]?.aggregation).toBe("sum");
    });

    it("should accept a valid partial update and keep the InsightMetric shape intact", async () => {
      const { tableId, insightId, metricId } = await makeInsightWithMetric();

      await commit(
        cmd("UpdateMetric", {
          nodeId: insightId,
          metricId,
          updates: { name: "Revenue (Total)", aggregation: "avg" } as never,
        }),
      );

      const rows = await insightsById(insightId);
      const def = rows[0]?.definition as {
        metrics: {
          id: string;
          name: string;
          sourceTable: string;
          aggregation: string;
        }[];
      };
      expect(def.metrics).toHaveLength(1);
      const stored = def.metrics[0]!;
      expect(stored.id).toBe(metricId);
      expect(stored.name).toBe("Revenue (Total)");
      expect(stored.sourceTable).toBe(tableId); // untouched key survives the merge
      expect(stored.aggregation).toBe("avg");
    });
  });

  // ===========================================================================
  // Visualization commands
  // ===========================================================================

  describe("CreateVisualization / SetChartType / SetChartEncoding", () => {
    it("should create a visualization and change its chart type", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      const vizId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("CreateVisualization", {
          id: vizId,
          name: "Chart",
          insightId,
          visualizationType: "barY",
          spec: {},
        }),
      );

      const rows = await vizsById(vizId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.chartType).toBe("barY");

      await commit(
        cmd("SetChartType", { id: vizId, visualizationType: "line" }),
      );
      const rows2 = await vizsById(vizId);
      expect(rows2[0]?.chartType).toBe("line");
    });

    it("should set the encoding (and optionally the spec) for SetChartEncoding", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      const vizId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("CreateVisualization", {
          id: vizId,
          name: "Chart",
          insightId,
          visualizationType: "barY",
          spec: {},
        }),
      );

      const encoding = { x: "field:abc", y: "metric:xyz" } as never;
      await commit(cmd("SetChartEncoding", { id: vizId, encoding }));
      const rows = await vizsById(vizId);
      expect(rows[0]?.encoding).toEqual(encoding);
    });

    it("should throw on SetChartType for a missing visualization (no silent no-op)", async () => {
      await expect(
        commit(cmd("SetChartType", { id: id(), visualizationType: "line" })),
      ).rejects.toThrow(/not found/);
    });

    it("should throw on SetChartEncoding for a missing visualization (no silent no-op)", async () => {
      await expect(
        commit(cmd("SetChartEncoding", { id: id(), encoding: {} as never })),
      ).rejects.toThrow(/not found/);
    });
  });

  // ===========================================================================
  // Dashboard commands
  // ===========================================================================

  describe("CreateDashboard / AddDashboardItem / UpdateDashboardItem / SetDashboardLayout / RemoveDashboardItem", () => {
    it("should create a dashboard and add two items", async () => {
      const dashId = id();
      const { tableId } = await makeTable();
      const insightId = id();
      const vizId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("CreateVisualization", {
          id: vizId,
          name: "V",
          insightId,
          visualizationType: "barY",
          spec: {},
        }),
        cmd("CreateDashboard", { id: dashId, name: "My Dashboard" }),
      );

      const itemId = id();
      const markdownId = id();
      await commit(
        cmd("AddDashboardItem", {
          dashboardId: dashId,
          item: {
            id: itemId,
            type: "visualization",
            visualizationId: vizId,
            x: 0,
            y: 0,
            width: 6,
            height: 4,
          },
        }),
        cmd("AddDashboardItem", {
          dashboardId: dashId,
          item: {
            id: markdownId,
            type: "markdown",
            content: "## Hello",
            x: 6,
            y: 0,
            width: 6,
            height: 4,
          },
        }),
      );

      const rows = await dashboardsById(dashId);
      const layout = rows[0]?.layout as { id: string }[];
      expect(layout).toHaveLength(2);
      expect(layout.map((it) => it.id)).toContain(itemId);
      expect(layout.map((it) => it.id)).toContain(markdownId);
    });

    it("should reject a duplicate item id in AddDashboardItem (no illegal two-items-one-id state)", async () => {
      const dashId = id();
      const itemId = id();
      await commit(
        cmd("CreateDashboard", { id: dashId, name: "D" }),
        cmd("AddDashboardItem", {
          dashboardId: dashId,
          item: {
            id: itemId,
            type: "markdown",
            content: "A",
            x: 0,
            y: 0,
            width: 3,
            height: 3,
          },
        }),
      );

      await expect(
        commit(
          cmd("AddDashboardItem", {
            dashboardId: dashId,
            item: {
              id: itemId,
              type: "markdown",
              content: "A dup",
              x: 1,
              y: 1,
              width: 3,
              height: 3,
            },
          }),
        ),
      ).rejects.toThrow(/already exists/);
    });

    it("should update an item without rebinding id or type", async () => {
      const dashId = id();
      const itemId = id();
      await commit(
        cmd("CreateDashboard", { id: dashId, name: "D" }),
        cmd("AddDashboardItem", {
          dashboardId: dashId,
          item: {
            id: itemId,
            type: "markdown",
            content: "Original",
            x: 0,
            y: 0,
            width: 3,
            height: 3,
          },
        }),
      );

      // updates.id and updates.type must be ignored (pinned by handler).
      await commit(
        cmd("UpdateDashboardItem", {
          dashboardId: dashId,
          itemId,
          updates: {
            content: "Updated",
            x: 2,
            id: id(),
            type: "visualization",
          } as never,
        }),
      );

      const rows = await dashboardsById(dashId);
      const layout = rows[0]?.layout as {
        id: string;
        type: string;
        content: string;
        x: number;
      }[];
      expect(layout[0]?.id).toBe(itemId);
      expect(layout[0]?.type).toBe("markdown"); // type pinned
      expect(layout[0]?.content).toBe("Updated");
      expect(layout[0]?.x).toBe(2);
    });

    it("should throw on UpdateDashboardItem with a missing itemId (no silent no-op)", async () => {
      const dashId = id();
      await commit(cmd("CreateDashboard", { id: dashId, name: "D" }));
      await expect(
        commit(
          cmd("UpdateDashboardItem", {
            dashboardId: dashId,
            itemId: id(),
            updates: { x: 1 },
          }),
        ),
      ).rejects.toThrow(/not found/);
    });

    it("should reject an AddDashboardItem with a bogus type or non-numeric position (validate before storing)", async () => {
      // Regression: the raw command path only checked item.id and persisted the
      // rest verbatim, so `{ type: "bogus" }` or `{ x: "0" }` could land in
      // dashboards.layout — but readers and layout rendering assume a known type
      // and numeric x/y/width/height. The fix validates the shape at the write
      // boundary (mirrors parseDashboardType + parsePosition in dashboards.ts).
      const dashId = id();
      await commit(cmd("CreateDashboard", { id: dashId, name: "D" }));

      await expect(
        commit(
          cmd("AddDashboardItem", {
            dashboardId: dashId,
            item: {
              id: id(),
              type: "bogus",
              x: 0,
              y: 0,
              width: 3,
              height: 3,
            } as never,
          }),
        ),
      ).rejects.toThrow(/type/);

      await expect(
        commit(
          cmd("AddDashboardItem", {
            dashboardId: dashId,
            item: {
              id: id(),
              type: "markdown",
              x: "0",
              y: 0,
              width: 3,
              height: 3,
            } as never,
          }),
        ),
      ).rejects.toThrow(/must be a number/);

      // Neither malformed item persisted.
      const rows = await dashboardsById(dashId);
      expect(rows[0]?.layout as unknown[]).toHaveLength(0);
    });

    it("should drop malformed update fields instead of writing them into the layout (sanitize before merge)", async () => {
      // Regression: UpdateDashboardItem merged `updates` verbatim, so
      // `{ x: "left", width: null }` corrupted numeric layout coordinates. The fix
      // filters updates to recognized fields with correct primitive types
      // (mirrors sanitizeDashboardUpdates in dashboards.ts).
      const dashId = id();
      const itemId = id();
      await commit(
        cmd("CreateDashboard", { id: dashId, name: "D" }),
        cmd("AddDashboardItem", {
          dashboardId: dashId,
          item: {
            id: itemId,
            type: "markdown",
            content: "A",
            x: 1,
            y: 2,
            width: 3,
            height: 4,
          },
        }),
      );

      await commit(
        cmd("UpdateDashboardItem", {
          dashboardId: dashId,
          itemId,
          // x is a valid number (applied); width is null and content is a number
          // (both dropped — wrong primitive types).
          updates: { x: 9, width: null, content: 5 } as never,
        }),
      );

      const rows = await dashboardsById(dashId);
      const item = (rows[0]?.layout as Record<string, unknown>[])[0]!;
      expect(item.x).toBe(9); // valid numeric update applied
      expect(item.width).toBe(3); // null dropped, original numeric kept
      expect(item.content).toBe("A"); // wrong-typed update dropped
    });

    it("should replace the whole layout for SetDashboardLayout", async () => {
      const dashId = id();
      const item1 = id();
      const item2 = id();
      await commit(
        cmd("CreateDashboard", { id: dashId, name: "D" }),
        cmd("AddDashboardItem", {
          dashboardId: dashId,
          item: {
            id: item1,
            type: "markdown",
            content: "A",
            x: 0,
            y: 0,
            width: 3,
            height: 3,
          },
        }),
      );

      // Replace-all with a new layout that includes both items at new positions.
      const newLayout = [
        {
          id: item1,
          type: "markdown" as const,
          content: "A",
          x: 1,
          y: 0,
          width: 3,
          height: 3,
        },
        {
          id: item2,
          type: "markdown" as const,
          content: "B",
          x: 4,
          y: 0,
          width: 3,
          height: 3,
        },
      ];
      await commit(
        cmd("SetDashboardLayout", { dashboardId: dashId, items: newLayout }),
      );

      const rows = await dashboardsById(dashId);
      const layout = rows[0]?.layout as { id: string; x: number }[];
      expect(layout).toHaveLength(2);
      expect(layout.find((it) => it.id === item1)?.x).toBe(1);
      expect(layout.find((it) => it.id === item2)?.x).toBe(4);
    });

    it("should reject duplicate item ids in SetDashboardLayout (no corrupt state for UpdateDashboardItem/RemoveDashboardItem)", async () => {
      const dashId = id();
      const itemId = id();
      await commit(
        cmd("CreateDashboard", { id: dashId, name: "D" }),
        cmd("AddDashboardItem", {
          dashboardId: dashId,
          item: {
            id: itemId,
            type: "markdown",
            content: "A",
            x: 0,
            y: 0,
            width: 3,
            height: 3,
          },
        }),
      );
      await expect(
        commit(
          cmd("SetDashboardLayout", {
            dashboardId: dashId,
            items: [
              {
                id: itemId,
                type: "markdown" as const,
                content: "A",
                x: 1,
                y: 0,
                width: 3,
                height: 3,
              },
              {
                id: itemId,
                type: "markdown" as const,
                content: "A",
                x: 4,
                y: 0,
                width: 3,
                height: 3,
              },
            ],
          }),
        ),
      ).rejects.toThrow("duplicate ids");
    });

    it("should remove a dashboard item by id", async () => {
      const dashId = id();
      const itemId = id();
      await commit(
        cmd("CreateDashboard", { id: dashId, name: "D" }),
        cmd("AddDashboardItem", {
          dashboardId: dashId,
          item: {
            id: itemId,
            type: "markdown",
            content: "A",
            x: 0,
            y: 0,
            width: 3,
            height: 3,
          },
        }),
      );

      await commit(cmd("RemoveDashboardItem", { dashboardId: dashId, itemId }));
      const rows = await dashboardsById(dashId);
      expect(rows[0]?.layout).toEqual([]);
    });

    it("should throw on RemoveDashboardItem with a missing itemId (no silent no-op)", async () => {
      const dashId = id();
      await commit(cmd("CreateDashboard", { id: dashId, name: "D" }));
      await expect(
        commit(
          cmd("RemoveDashboardItem", { dashboardId: dashId, itemId: id() }),
        ),
      ).rejects.toThrow(/not found/);
    });

    it("should throw on AddDashboardItem for a missing dashboard (no silent no-op)", async () => {
      await expect(
        commit(
          cmd("AddDashboardItem", {
            dashboardId: id(),
            item: {
              id: id(),
              type: "markdown",
              content: "X",
              x: 0,
              y: 0,
              width: 3,
              height: 3,
            },
          }),
        ),
      ).rejects.toThrow(/not found/);
    });
  });

  // ===========================================================================
  // Cross-cutting — DeleteNode + extended RenameNode
  // ===========================================================================

  describe("DeleteNode (polymorphic delete)", () => {
    it("should delete a DataSource by id", async () => {
      const sourceId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      );
      const result = await commit(cmd("DeleteNode", { id: sourceId }));
      expect(await sourcesById(sourceId)).toHaveLength(0);
      // No reference-boundary nodes — orphanedNodes is empty.
      expect(result.results[0]?.value).toMatchObject({
        ok: true,
        orphanedNodes: [],
      });
    });

    it("should delete an Insight by id", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );
      const result = await commit(cmd("DeleteNode", { id: insightId }));
      expect(await insightsById(insightId)).toHaveLength(0);
      expect(result.results[0]?.value).toMatchObject({
        ok: true,
        orphanedNodes: [],
      });
    });

    it("should delete a Visualization by id", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      const vizId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("CreateVisualization", {
          id: vizId,
          name: "V",
          insightId,
          visualizationType: "barY",
          spec: {},
        }),
      );
      const result = await commit(cmd("DeleteNode", { id: vizId }));
      expect(await vizsById(vizId)).toHaveLength(0);
      // The parent Insight is untouched.
      expect(await insightsById(insightId)).toHaveLength(1);
      expect(result.results[0]?.value).toMatchObject({
        ok: true,
        orphanedNodes: [],
      });
    });

    it("should surface dashboards that reference a deleted Visualization in orphanedNodes (reference boundary)", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      const vizId = id();
      const dashId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("CreateVisualization", {
          id: vizId,
          name: "V",
          insightId,
          visualizationType: "barY",
          spec: {},
        }),
        cmd("CreateDashboard", { id: dashId, name: "D" }),
        cmd("AddDashboardItem", {
          dashboardId: dashId,
          item: {
            id: id(),
            type: "visualization",
            visualizationId: vizId,
            x: 0,
            y: 0,
            width: 4,
            height: 3,
          },
        }),
      );

      const result = await commit(cmd("DeleteNode", { id: vizId }));

      expect(await vizsById(vizId)).toHaveLength(0);
      const value = result.results[0]?.value as {
        orphanedNodes: { id: string; kind: string }[];
      };
      // The dashboard is surfaced as an orphaned node (its viz item is now stale).
      expect(value.orphanedNodes).toHaveLength(1);
      expect(value.orphanedNodes[0]).toMatchObject({
        id: dashId,
        kind: "dashboard",
      });
      // The dashboard itself is NOT deleted.
      expect(await dashboardsById(dashId)).toHaveLength(1);
    });

    it("should delete a Dashboard by id", async () => {
      const dashId = id();
      await commit(cmd("CreateDashboard", { id: dashId, name: "D" }));
      const result = await commit(cmd("DeleteNode", { id: dashId }));
      expect(await dashboardsById(dashId)).toHaveLength(0);
      expect(result.results[0]?.value).toMatchObject({
        ok: true,
        orphanedNodes: [],
      });
    });

    it("should throw on DeleteNode for an unknown id (no silent no-op)", async () => {
      await expect(commit(cmd("DeleteNode", { id: id() }))).rejects.toThrow(
        /not found/,
      );
    });
  });

  // ===========================================================================
  // DeleteNode — typed-edge cascade rule + orphan-and-warn
  // ===========================================================================

  describe("DeleteNode — typed-edge cascade rule", () => {
    // -------------------------------------------------------------------------
    // Owned-edge cascade: Insight → Visualization (schema FK, onDelete cascade)
    // -------------------------------------------------------------------------

    it("should cascade-delete owned Visualizations when their Insight is deleted (ownership edge)", async () => {
      // Spec — DashFrame Artifact Model: Visualization is owned by its Insight
      // (it has no independent value without the query that produces it).
      // The DB schema's onDelete:cascade on visualizations.insight_id enforces
      // this; DeleteNode must not block it.
      const { tableId } = await makeTable();
      const insightId = id();
      const vizId = id();
      const viz2Id = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("CreateVisualization", {
          id: vizId,
          name: "V1",
          insightId,
          visualizationType: "barY",
          spec: {},
        }),
        cmd("CreateVisualization", {
          id: viz2Id,
          name: "V2",
          insightId,
          visualizationType: "line",
          spec: {},
        }),
      );

      await commit(cmd("DeleteNode", { id: insightId }));

      // Insight is gone.
      expect(await insightsById(insightId)).toHaveLength(0);
      // Both Visualizations are gone (cascade through the ownership edge).
      expect(await vizsById(vizId)).toHaveLength(0);
      expect(await vizsById(viz2Id)).toHaveLength(0);
    });

    it("should surface dashboards that contain an Insight's owned Visualizations in orphanedNodes when the Insight is deleted", async () => {
      // When deleting an Insight, its Visualizations cascade-delete via FK.
      // Any Dashboard that had a layout item referencing one of those Visualizations
      // is now left with a stale tile — it must appear in orphanedNodes.
      const { tableId } = await makeTable();
      const insightId = id();
      const vizId = id();
      const dashId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("CreateVisualization", {
          id: vizId,
          name: "V",
          insightId,
          visualizationType: "barY",
          spec: {},
        }),
        cmd("CreateDashboard", { id: dashId, name: "D" }),
        cmd("AddDashboardItem", {
          dashboardId: dashId,
          item: {
            id: id(),
            type: "visualization",
            visualizationId: vizId,
            x: 0,
            y: 0,
            width: 4,
            height: 3,
          },
        }),
      );

      const result = await commit(cmd("DeleteNode", { id: insightId }));

      expect(await insightsById(insightId)).toHaveLength(0);
      expect(await vizsById(vizId)).toHaveLength(0);
      // The dashboard is surfaced as an orphaned node.
      const value = result.results[0]?.value as {
        orphanedNodes: { id: string; kind: string }[];
      };
      const dashboardOrphans = value.orphanedNodes.filter(
        (n) => n.kind === "dashboard",
      );
      expect(dashboardOrphans).toHaveLength(1);
      expect(dashboardOrphans[0]?.id).toBe(dashId);
      // The dashboard itself is NOT deleted.
      expect(await dashboardsById(dashId)).toHaveLength(1);
    });

    it("should cascade-delete owned DataTables when their DataSource is deleted (ownership edge)", async () => {
      // DataSource → DataTable is the only ownership edge in the graph.
      // Deleting a DataSource must remove all its DataTables.
      const sourceId = id();
      const tableId = id();
      const table2Id = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T1",
          table: "t1.csv",
        }),
        cmd("CreateDataTable", {
          id: table2Id,
          dataSourceId: sourceId,
          name: "T2",
          table: "t2.csv",
        }),
      );

      await commit(cmd("DeleteNode", { id: sourceId }));

      expect(await sourcesById(sourceId)).toHaveLength(0);
      expect(await tablesById(tableId)).toHaveLength(0);
      expect(await tablesById(table2Id)).toHaveLength(0);
    });

    // -------------------------------------------------------------------------
    // Reference-edge stop: DataTable → Insight (orphan-and-warn)
    // -------------------------------------------------------------------------

    it("should surface orphaned Insights when a DataTable they source is deleted (reference boundary)", async () => {
      // The Artifact Model's typed-edge rule: DataTable → Insight is a reference
      // edge. Deleting the DataTable must NOT auto-delete the Insight; instead it
      // must return the Insight in orphanedNodes so the caller can route it to
      // drift-repair. The Insight remains in the DB, reachable but broken.
      const { tableId } = await makeTable();
      const insight1Id = id();
      const insight2Id = id();
      await commit(
        cmd("CreateInsight", {
          id: insight1Id,
          name: "I1",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("CreateInsight", {
          id: insight2Id,
          name: "I2",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );

      const result = await commit(cmd("DeleteNode", { id: tableId }));

      // DataTable is gone.
      expect(await tablesById(tableId)).toHaveLength(0);
      // Insights survive — they are NOT cascade-deleted.
      expect(await insightsById(insight1Id)).toHaveLength(1);
      expect(await insightsById(insight2Id)).toHaveLength(1);
      // Both are surfaced as orphanedNodes for the caller to route to repair.
      const value = result.results[0]?.value as {
        ok: boolean;
        orphanedNodes: { id: string; kind: string }[];
      };
      expect(value.ok).toBe(true);
      expect(value.orphanedNodes).toHaveLength(2);
      expect(value.orphanedNodes.map((n) => n.id).sort()).toEqual(
        [insight1Id, insight2Id].sort(),
      );
      expect(value.orphanedNodes.every((n) => n.kind === "insight")).toBe(true);
    });

    it("should surface orphaned Insights when a DataSource (and its DataTables) is deleted (reference boundary through cascade)", async () => {
      // When a DataSource is deleted, its DataTables cascade-delete (ownership).
      // Any Insights that sourced those DataTables hit the reference boundary and
      // must be surfaced as orphanedNodes — the delete blast-radius extends to
      // the source's descendants at the reference edge.
      const { sourceId, tableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );

      const result = await commit(cmd("DeleteNode", { id: sourceId }));

      expect(await sourcesById(sourceId)).toHaveLength(0);
      expect(await tablesById(tableId)).toHaveLength(0);
      // Insight survives — reference edge stops the cascade.
      expect(await insightsById(insightId)).toHaveLength(1);
      const value = result.results[0]?.value as {
        ok: boolean;
        orphanedNodes: { id: string; kind: string }[];
      };
      expect(value.orphanedNodes).toHaveLength(1);
      expect(value.orphanedNodes[0]?.id).toBe(insightId);
      expect(value.orphanedNodes[0]?.kind).toBe("insight");
    });

    // -------------------------------------------------------------------------
    // Reference-edge stop: Insight → derived Insight (orphan-and-warn)
    // -------------------------------------------------------------------------

    it("should surface orphaned derived Insights when their upstream Insight is deleted (Insight-on-Insight reference boundary)", async () => {
      // Insight-on-Insight composition: the derived Insight sources the deleted
      // Insight. This is another reference edge — the derived Insight is an
      // independently-authored artifact that must NOT be cascade-deleted.
      const { tableId } = await makeTable();
      const baseInsightId = id();
      const derivedInsightId = id();
      await commit(
        cmd("CreateInsight", {
          id: baseInsightId,
          name: "Base",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("CreateInsight", {
          id: derivedInsightId,
          name: "Derived",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );
      // Re-point the derived Insight to source from the base.
      await commit(
        cmd("SetInsightSource", {
          id: derivedInsightId,
          source: { sourceType: "insight", sourceId: baseInsightId },
        }),
      );

      const result = await commit(cmd("DeleteNode", { id: baseInsightId }));

      // Base Insight is gone.
      expect(await insightsById(baseInsightId)).toHaveLength(0);
      // Derived Insight survives — it is a separately-authored artifact.
      expect(await insightsById(derivedInsightId)).toHaveLength(1);
      const value = result.results[0]?.value as {
        ok: boolean;
        orphanedNodes: { id: string; kind: string }[];
      };
      expect(value.orphanedNodes).toHaveLength(1);
      expect(value.orphanedNodes[0]?.id).toBe(derivedInsightId);
      expect(value.orphanedNodes[0]?.kind).toBe("insight");
    });

    it("should not surface duplicate orphaned Insights when two DataTables from one DataSource both feed the same Insight", async () => {
      // Deduplication invariant: an Insight that transitively sources two
      // DataTables from the same DataSource must appear only once in
      // orphanedNodes. Two separate source refs → same orphan id → one entry.
      // (This is a rare but structurally possible configuration when joins
      // reference two tables from the same source; we test the dedup path.)
      const sourceId = id();
      const table1Id = id();
      const table2Id = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: table1Id,
          dataSourceId: sourceId,
          name: "T1",
          table: "t1.csv",
        }),
        cmd("CreateDataTable", {
          id: table2Id,
          dataSourceId: sourceId,
          name: "T2",
          table: "t2.csv",
        }),
      );
      // Single Insight sources table1; table2 doesn't have an Insight over it.
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: table1Id },
        }),
      );

      const result = await commit(cmd("DeleteNode", { id: sourceId }));

      const value = result.results[0]?.value as {
        orphanedNodes: { id: string }[];
      };
      // Insight appears exactly once even though the DataSource has 2 tables.
      expect(
        value.orphanedNodes.filter((n) => n.id === insightId),
      ).toHaveLength(1);
    });

    it("should surface orphaned Insights when a DataTable they JOIN against is deleted (join-dependency boundary)", async () => {
      // An Insight that uses a DataTable only as a JOIN target (not as its
      // primary source) is still orphaned when that table is deleted. Verify
      // that findOrphanedInsights checks joins[*].rightTableId.
      const { tableId: primaryTableId } = await makeTable();
      const { tableId: joinTableId } = await makeTable();
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: primaryTableId },
        }),
        // Add a join that references joinTableId as the right-hand side.
        cmd("AddJoin", {
          id: insightId,
          join: {
            type: "inner",
            rightTableId: joinTableId,
            leftKey: "id",
            rightKey: "id",
          },
        }),
      );

      const result = await commit(cmd("DeleteNode", { id: joinTableId }));

      const value = result.results[0]?.value as {
        orphanedNodes: { id: string; kind: string }[];
      };
      expect(value.orphanedNodes.map((n) => n.id)).toContain(insightId);
    });

    it("should surface an Insight only once when it sources AND joins against tables from the same DataSource", async () => {
      // Dedup: an Insight whose primary source AND one of its joins both point
      // at tables owned by a deleted DataSource must appear exactly once.
      const sourceId = id();
      const table1Id = id();
      const table2Id = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: table1Id,
          dataSourceId: sourceId,
          name: "T1",
          table: "t1.csv",
        }),
        cmd("CreateDataTable", {
          id: table2Id,
          dataSourceId: sourceId,
          name: "T2",
          table: "t2.csv",
        }),
      );
      const insightId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: table1Id },
        }),
        cmd("AddJoin", {
          id: insightId,
          join: {
            type: "left",
            rightTableId: table2Id,
            leftKey: "id",
            rightKey: "id",
          },
        }),
      );

      const result = await commit(cmd("DeleteNode", { id: sourceId }));

      const value = result.results[0]?.value as {
        orphanedNodes: { id: string }[];
      };
      expect(
        value.orphanedNodes.filter((n) => n.id === insightId),
      ).toHaveLength(1);
    });

    // -------------------------------------------------------------------------
    // Arrow / DataFrame metadata cleanup
    // -------------------------------------------------------------------------

    it("should delete the DataFrame metadata row when an Insight is deleted (Arrow cleanup signal)", async () => {
      // The dataFrames table stores metadata-only; the actual Arrow bytes live in
      // the renderer's IndexedDB. Deleting the metadata row signals the client-
      // side removeDataFrame hook to clean up Arrow bytes via deleteArrowData().
      // Test: after DeleteNode(insight), the dataFrames row with insightId is gone.
      const { tableId } = await makeTable();
      const insightId = id();
      const frameId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
      );
      // Directly insert a DataFrame row linked to this Insight to simulate a
      // cached result (the applyCommands vocabulary has no PutDataFrame command
      // yet; we write the row via the raw Drizzle handle used by test helpers).
      await db.insert(schema.dataFrames).values({
        id: frameId,
        storage: { type: "indexeddb", key: `arrow-${frameId}` },
        fieldIds: [],
        name: `Frame for ${insightId}`,
        insightId,
        createdAt: new Date(),
      });

      const rows = await db.select().from(schema.dataFrames);
      expect(rows.filter((r) => r.insightId === insightId)).toHaveLength(1);

      await commit(cmd("DeleteNode", { id: insightId }));

      // The DataFrame metadata row must be gone after the Insight is deleted.
      const afterRows = await db.select().from(schema.dataFrames);
      expect(afterRows.filter((r) => r.insightId === insightId)).toHaveLength(
        0,
      );
    });
  });

  describe("RenameNode (extended to Visualization and Dashboard)", () => {
    it("should rename a Visualization", async () => {
      const { tableId } = await makeTable();
      const insightId = id();
      const vizId = id();
      await commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "I",
          source: { sourceType: "dataTable", sourceId: tableId },
        }),
        cmd("CreateVisualization", {
          id: vizId,
          name: "Old",
          insightId,
          visualizationType: "barY",
          spec: {},
        }),
      );

      await commit(cmd("RenameNode", { id: vizId, name: "New" }));
      const rows = await vizsById(vizId);
      expect(rows[0]?.name).toBe("New");
    });

    it("should rename a Dashboard", async () => {
      const dashId = id();
      await commit(cmd("CreateDashboard", { id: dashId, name: "Old" }));
      await commit(cmd("RenameNode", { id: dashId, name: "New" }));
      const rows = await dashboardsById(dashId);
      expect(rows[0]?.name).toBe("New");
    });
  });

  describe("CSV ingest via CreateDataTable — default Count metric preserved", () => {
    /**
     * No-regression contract: CSV ingest that migrated from the legacy
     * `addDataTable` mutation (which auto-injected Count via
     * `withDefaultCountMetric`) to the `CreateDataTable` command (a
     * PRIMITIVE — no auto-inject) must produce the same row shape.
     * The caller is now responsible for passing the Count metric explicitly.
     *
     * This test asserts the contract: a DataTable created via CreateDataTable
     * with an explicit default Count metric has exactly one Count metric and
     * the metric matches the expected shape.
     */
    it("should produce a DataTable with the default Count metric when the caller passes it explicitly", async () => {
      const sourceId = id();
      const tableId = id();
      const metricId = id();

      await commit(
        cmd("GetOrCreateDataSource", {
          id: sourceId,
          type: "local",
          name: "Local Files",
        }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "sales",
          table: "sales.csv",
          metrics: [
            {
              id: metricId,
              name: "Count",
              tableId,
              columnName: undefined,
              aggregation: "count",
            },
          ],
        }),
      );

      const [row] = await tablesById(tableId);
      const metrics = (row?.metrics ?? []) as {
        id: string;
        name: string;
        tableId: string;
        columnName: unknown;
        aggregation: string;
      }[];

      // Exactly one metric — the default Count metric the caller supplied.
      expect(metrics).toHaveLength(1);
      expect(metrics[0]?.id).toBe(metricId);
      expect(metrics[0]?.name).toBe("Count");
      expect(metrics[0]?.tableId).toBe(tableId);
      expect(metrics[0]?.columnName).toBeUndefined();
      expect(metrics[0]?.aggregation).toBe("count");
    });

    it("should NOT auto-inject a Count metric — CreateDataTable is a primitive (caller owns metrics)", async () => {
      // Verifies the command's PRIMITIVE contract: unlike the legacy
      // `addDataTable` mutation, CreateDataTable stores exactly what the caller
      // passes. If the caller omits metrics, the row has no metrics — no
      // silent injection.
      const sourceId = id();
      const tableId = id();

      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
        cmd("CreateDataTable", {
          id: tableId,
          dataSourceId: sourceId,
          name: "T",
          table: "t.csv",
          // No metrics supplied — CreateDataTable stores an empty array.
        }),
      );

      const [row] = await tablesById(tableId);
      expect(row?.metrics).toEqual([]);
    });
  });

  describe("JSONB payload validation (sink-guard: validate at point of USE)", () => {
    // These tests verify the fix for YW-290: corrupt / unexpected JSONB blobs
    // must produce a clear validation error, never throw on property access.

    describe("source arg validation (insightSourceSchema)", () => {
      it("should reject a corrupt source arg in CreateInsight with a clear validation error (not a crash)", async () => {
        const { tableId } = await makeTable();

        // A corrupt source: `sourceType` is missing entirely. Without the Zod
        // guard the handler would cast this as `InsightSource` and then the
        // `sourceType !== 'dataTable' && sourceType !== 'insight'` check would
        // receive `undefined`, producing an opaque mismatched-type error rather
        // than a schema-violation message.
        await expect(
          commit(
            cmd("CreateInsight", {
              id: id(),
              name: "I",
              // @ts-expect-error — intentionally passing a corrupt shape to
              // exercise the runtime Zod validation path.
              source: { sourceId: tableId },
            }),
          ),
        ).rejects.toThrow(/CreateInsight: source is invalid/);
      });

      it("should reject a source arg with an unknown sourceType in CreateInsight", async () => {
        const { tableId } = await makeTable();

        await expect(
          commit(
            cmd("CreateInsight", {
              id: id(),
              name: "I",
              // @ts-expect-error — intentionally passing an invalid sourceType.
              source: { sourceType: "unknown", sourceId: tableId },
            }),
          ),
        ).rejects.toThrow(/CreateInsight: source is invalid/);
      });

      it("should reject a non-string sourceId in CreateInsight source arg", async () => {
        await expect(
          commit(
            cmd("CreateInsight", {
              id: id(),
              name: "I",
              // @ts-expect-error — sourceId must be a string.
              source: { sourceType: "dataTable", sourceId: 42 },
            }),
          ),
        ).rejects.toThrow(/CreateInsight: source is invalid/);
      });

      it("should reject a corrupt source arg in SetInsightSource with a clear validation error", async () => {
        const { tableId } = await makeTable();
        const insightId = id();
        await commit(
          cmd("CreateInsight", {
            id: insightId,
            name: "I",
            source: { sourceType: "dataTable", sourceId: tableId },
          }),
        );

        await expect(
          commit(
            cmd("SetInsightSource", {
              id: insightId,
              // @ts-expect-error — corrupt shape: missing sourceType.
              source: { sourceId: tableId },
            }),
          ),
        ).rejects.toThrow(/SetInsightSource: source is invalid/);
      });
    });

    describe("stored definition validation (storedInsightDefinitionSchema)", () => {
      // Note: `db.update(schema.insights).set({...})` has no `.where()` — the
      // pattern from line 80 comment: each test has a `beforeEach` fresh DB and
      // creates exactly one insight, so the unscoped update is safe in isolation.
      // If a future test edit adds a second insight before the corrupt step,
      // add `.where(eq(schema.insights.id, insightId))` using drizzle-orm's eq.

      it("should reject a corrupt stored definition with a clear validation error (not a crash on property access)", async () => {
        const { tableId } = await makeTable();
        const insightId = id();

        // Create a valid insight first.
        await commit(
          cmd("CreateInsight", {
            id: insightId,
            name: "I",
            source: { sourceType: "dataTable", sourceId: tableId },
          }),
        );

        // Corrupt the stored definition directly via the raw Drizzle handle,
        // simulating a schema-drift scenario (e.g. a future migration wrote
        // an unexpected shape, or an external process updated the row).
        // The `baseTableId` key is missing — a required field in the schema.
        const corruptDefinition = {
          selectedFields: [],
          metrics: [],
          // baseTableId intentionally omitted
        };
        await db.update(schema.insights).set({ definition: corruptDefinition });

        // Any command that reads back the definition — including write-path
        // commands that call requireInsightDefinition (SetInsightSource,
        // SelectFields, AddField on Insight, AddMetric on Insight) — must throw
        // a clean "corrupt definition" error, not crash on property access.
        await expect(
          commit(
            cmd("SetInsightSource", {
              id: insightId,
              source: { sourceType: "dataTable", sourceId: tableId },
            }),
          ),
        ).rejects.toThrow(/corrupt definition/);
      });

      it("should reject a definition where selectedFields is not an array", async () => {
        const { tableId } = await makeTable();
        const insightId = id();

        await commit(
          cmd("CreateInsight", {
            id: insightId,
            name: "I",
            source: { sourceType: "dataTable", sourceId: tableId },
          }),
        );

        // Corrupt the definition: selectedFields is a string instead of an array.
        await db.update(schema.insights).set({
          definition: {
            baseTableId: tableId,
            selectedFields: "not-an-array",
            metrics: [],
          },
        });

        await expect(
          commit(cmd("SelectFields", { id: insightId, fieldIds: [] })),
        ).rejects.toThrow(/corrupt definition/);
      });

      it("should reject a corrupt definition on AddField (Insight node path, not just SetInsightSource)", async () => {
        // Verifies that patchInsightSelectedFields routes through
        // requireInsightDefinition — the MUST fix for the AddField/RemoveField
        // on-Insight crash class. A corrupt definition must produce a clean error,
        // not crash on undefined property access inside patchInsightSelectedFields.
        const { tableId } = await makeTable();
        const insightId = id();

        await commit(
          cmd("CreateInsight", {
            id: insightId,
            name: "I",
            source: { sourceType: "dataTable", sourceId: tableId },
          }),
        );

        await db
          .update(schema.insights)
          .set({ definition: { metrics: [], selectedFields: 99 } });

        await expect(
          commit(
            cmd("AddField", {
              nodeId: insightId,
              field: {
                id: id(),
                name: "f",
                tableId,
                columnName: "c",
                type: "string",
              },
            }),
          ),
        ).rejects.toThrow(/corrupt definition/);
      });

      it("should reject a corrupt definition on AddMetric (Insight node path)", async () => {
        // Verifies that patchDataTableCollection's insight-metrics branch routes
        // through requireInsightDefinition — the second MUST fix. A corrupt
        // metrics-bearing definition must produce a clean error.
        const { tableId } = await makeTable();
        const insightId = id();

        await commit(
          cmd("CreateInsight", {
            id: insightId,
            name: "I",
            source: { sourceType: "dataTable", sourceId: tableId },
          }),
        );

        await db
          .update(schema.insights)
          .set({ definition: { selectedFields: [], metrics: "not-an-array" } });

        await expect(
          commit(
            cmd("AddMetric", {
              nodeId: insightId,
              metric: {
                id: id(),
                name: "m",
                sourceTable: tableId,
                aggregation: "sum",
              },
            }),
          ),
        ).rejects.toThrow(/corrupt definition/);
      });
    });
  });
});
