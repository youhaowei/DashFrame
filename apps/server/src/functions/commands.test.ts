/**
 * Command vocabulary (YW-106 + YW-123) tests.
 *
 * These exercise the vocabulary THROUGH the real engine: a batch of typed
 * commands (built with `cmd(...)`) dispatched by `@wystack/server`'s
 * `applyCommands` against a real artifact DB. They assert the contracts the
 * spec freezes — atomicity of GetOrCreateDataSource, batch atomicity with the
 * client-id invariant, each command mapping to the right write, mid-batch
 * rollback, and preview persisting nothing.
 *
 * YW-123 additions: Insight (incl. Insight-on-Insight composition and cycle
 * rejection), SelectFields, SetInsightFilter/Sort, AddJoin/UpdateJoin/RemoveJoin,
 * Visualization (CreateVisualization, SetChartType, SetChartEncoding), Dashboard
 * (CreateDashboard, AddDashboardItem, UpdateDashboardItem, SetDashboardLayout,
 * RemoveDashboardItem), DeleteNode, extended RenameNode, and AddField/UpdateField
 * on Insight nodes.
 */
import { openArtifactDb, schema } from "@dashframe/server-core";
import { createWyStack, type WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { functions } from "../functions";
import { cmd } from "./commands";

const { dataSources, dataTables, insights, visualizations, dashboards } =
  schema;

describe("command vocabulary", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  // applyCommands is registered alongside query/mutation on @wystack/server;
  // import lazily so the test reads top-down with the engine right where used.
  let applyCommands: typeof import("@wystack/server").applyCommands;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-cmd-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await createWyStack({ db, functions });
    ({ applyCommands } = await import("@wystack/server"));
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function id(): string {
    return crypto.randomUUID();
  }

  async function commit(...commands: ReturnType<typeof cmd>[]) {
    return applyCommands(app, commands, { mode: "commit" });
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
      expect((row?.config as { apiKey?: string }).apiKey).toBe("secret-key");
    });

    it("should replace only config (not name) for SetDataSourceConfig, decomposed from updateDataSource", async () => {
      const sourceId = id();
      await commit(
        cmd("CreateDataSource", {
          id: sourceId,
          type: "notion",
          name: "Original",
          apiKey: "old",
        }),
        cmd("SetDataSourceConfig", { id: sourceId, apiKey: "new" }),
      );
      const [row] = await sourcesById(sourceId);
      expect((row?.config as { apiKey?: string }).apiKey).toBe("new");
      expect(row?.name).toBe("Original");
    });

    it("should rename without touching config for RenameNode, decomposed from updateDataSource", async () => {
      const sourceId = id();
      await commit(
        cmd("CreateDataSource", {
          id: sourceId,
          type: "notion",
          name: "Original",
          apiKey: "keep",
        }),
        cmd("RenameNode", { id: sourceId, name: "Renamed" }),
      );
      const [row] = await sourcesById(sourceId);
      expect(row?.name).toBe("Renamed");
      expect((row?.config as { apiKey?: string }).apiKey).toBe("keep");
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
  // YW-123: Insight commands
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
      // Backwards-compat: baseTableId must equal the source id.
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
    });
  });

  describe("AddField / UpdateField on Insight node (YW-123 — fields on derived node)", () => {
    it("should add and update a field on an Insight node", async () => {
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
        fields: { id: string; name: string }[];
      };
      expect(def.fields).toHaveLength(1);
      expect(def.fields[0]?.id).toBe(fieldId);

      // UpdateField on an Insight node must pin id so updates.id cannot rebind.
      await commit(
        cmd("UpdateField", {
          nodeId: insightId,
          fieldId,
          updates: { name: "Net Revenue", id: id() } as never,
        }),
      );
      const rows2 = await insightsById(insightId);
      const def2 = rows2[0]?.definition as {
        fields: { id: string; name: string }[];
      };
      expect(def2.fields[0]?.id).toBe(fieldId); // id pinned
      expect(def2.fields[0]?.name).toBe("Net Revenue");
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

  // ===========================================================================
  // YW-123: Visualization commands
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
  // YW-123: Dashboard commands
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
  // YW-123: Cross-cutting — DeleteNode + extended RenameNode
  // ===========================================================================

  describe("DeleteNode (polymorphic delete)", () => {
    it("should delete a DataSource by id", async () => {
      const sourceId = id();
      await commit(
        cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
      );
      await commit(cmd("DeleteNode", { id: sourceId }));
      expect(await sourcesById(sourceId)).toHaveLength(0);
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
      await commit(cmd("DeleteNode", { id: insightId }));
      expect(await insightsById(insightId)).toHaveLength(0);
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
      await commit(cmd("DeleteNode", { id: vizId }));
      expect(await vizsById(vizId)).toHaveLength(0);
      // The parent Insight is untouched.
      expect(await insightsById(insightId)).toHaveLength(1);
    });

    it("should delete a Dashboard by id", async () => {
      const dashId = id();
      await commit(cmd("CreateDashboard", { id: dashId, name: "D" }));
      await commit(cmd("DeleteNode", { id: dashId }));
      expect(await dashboardsById(dashId)).toHaveLength(0);
    });

    it("should throw on DeleteNode for an unknown id (no silent no-op)", async () => {
      await expect(commit(cmd("DeleteNode", { id: id() }))).rejects.toThrow(
        /not found/,
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
});
