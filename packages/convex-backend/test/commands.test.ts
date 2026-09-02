import { beforeEach, describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import {
  cmd,
  COMMAND_PATHS,
  buildInsightUpdateCommands,
  type Insight,
  type CommandName,
  type Command,
} from "@dashframe/types";
import { storedInsightDefinitionSchema } from "../convex/insightCodec";
import type { ArtifactTable } from "../convex/model";
const modules = import.meta.glob("../convex/**/*.ts");
const fieldIdToColumnAlias = (id: string) => `field_${id.replaceAll("-", "_")}`;
const metricIdToColumnAlias = (id: string) =>
  `metric_${id.replaceAll("-", "_")}`;
const id = () => crypto.randomUUID();
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;
let client: ReturnType<typeof t.withIdentity>;
beforeEach(() => {
  t = convexTest(schema, modules);
  client = t.withIdentity({
    subject: "user",
    workspaceId: "test",
    principalKind: "user",
    userId: "user",
  });
});
const isSecretRef = (value: unknown) =>
  typeof value === "string" && value.startsWith("secret:");
const draftCommit = (...commands: Command[]) =>
  client.mutation(api.app.draftBatch, { commands });
const commit = async (...commands: Command[]) => {
  const staged = commands.map((c) => {
    const args = { ...(c.args as Record<string, unknown>) };
    for (const k of ["apiKey", "connectionString"])
      if (typeof args[k] === "string" && args[k]) args[k] = "secret:" + id();
    return { ...c, args };
  });
  if (
    commands.some((c) =>
      Object.keys(c.args as object).some(
        (k) => k === "apiKey" || k === "connectionString",
      ),
    )
  )
    return t.mutation(internal.host.commitBatch, {
      workspaceId: "test",
      principal: { kind: "user", userId: "user" },
      commands: staged as never,
    });
  return client.mutation(api.app.commitBatch, { commands });
};
async function rows(table: ArtifactTable) {
  const result = await t.run(
    async (ctx) =>
      await ctx.db
        .query(table)
        .withIndex("by_workspaceId_and_id", (q) => q.eq("workspaceId", "test"))
        .take(1000),
  );
  return result.map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : null,
    lastFetchedAt: row.lastFetchedAt ? new Date(row.lastFetchedAt) : null,
  }));
}
const sourcesById = async (id: string) =>
  (await rows("dataSources")).filter((r) => r.id === id);
const sourcesByKind = async (kind: string) =>
  (await rows("dataSources")).filter((r) => r.kind === kind);
const allSources = () => rows("dataSources");
const tablesById = async (id: string) =>
  (await rows("dataTables")).filter((r) => r.id === id);
const insightsById = async (id: string) =>
  (await rows("insights")).filter((r) => r.id === id);
const vizsById = async (id: string) =>
  (await rows("visualizations")).filter((r) => r.id === id);
const dashboardsById = async (id: string) =>
  (await rows("dashboards")).filter((r) => r.id === id);
async function makeTable() {
  const sourceId = id(),
    tableId = id();
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
async function makeFrame(frameId = id()) {
  await t.run((ctx) =>
    ctx.db.insert("dataFrames", {
      workspaceId: "test",
      id: frameId,
      revision: 1,
      name: "Test Frame",
      createdAt: Date.now(),
      storage: { type: "file", key: frameId },
      fieldIds: [],
    }),
  );
  return frameId;
}
function rawCmd(name: CommandName, args: Record<string, unknown>): Command {
  return { path: COMMAND_PATHS[name], args };
}
async function makeInsight(): Promise<string> {
  const { tableId } = await makeTable();
  const insightId = id();
  await commit(
    cmd("CreateInsight", {
      id: insightId,
      name: "I",
      source: { sourceType: "dataTable", sourceId: tableId },
      selectedFields: [id()],
    }),
  );
  return insightId;
}
async function storedDefinition(insightId: string): Promise<string> {
  const rows = await insightsById(insightId);
  expect(rows).toHaveLength(1);
  const json = JSON.stringify(rows[0]?.definition);
  // Anti-vacuity guard, in the helper so every caller inherits it: if the
  // fixture ever stopped persisting a definition, `json` would be the
  // string "undefined" and every byte-identity comparison built on it
  // would pass without proving anything.
  expect(json).toContain('"source"');
  return json;
}
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
        columnName: "revenue",
      },
    }),
  );
  return { tableId, insightId, metricId };
}
async function makeDashWithVizItem(overrides?: {
  existingFilters?: {
    field: string;
    operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
    value: unknown;
  }[];
}) {
  const { tableId } = await makeTable();
  const insightId = id();
  const vizId = id();
  const dashId = id();
  const sourceItemId = id();

  await commit(
    cmd("CreateInsight", {
      id: insightId,
      name: "Sales Insight",
      source: { sourceType: "dataTable", sourceId: tableId },
    }),
    cmd("CreateVisualization", {
      id: vizId,
      name: "Sales Chart",
      insightId,
      visualizationType: "barY",
      spec: {},
    }),
    cmd("CreateDashboard", { id: dashId, name: "Sales Dashboard" }),
    cmd("AddDashboardItem", {
      dashboardId: dashId,
      item: {
        id: sourceItemId,
        type: "visualization",
        visualizationId: vizId,
        x: 0,
        y: 0,
        width: 6,
        height: 4,
        ...(overrides?.existingFilters
          ? {
              overrides: {
                filters: overrides.existingFilters,
              },
            }
          : {}),
      },
    }),
  );

  return { tableId, insightId, vizId, dashId, sourceItemId };
}
describe("existing command behavior on native Convex", () => {
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
  it("does not attach the GA4 binding contract to other connector kinds", async () => {
    const sourceId = id();
    await commit(
      cmd("CreateDataSource", {
        id: sourceId,
        type: "notion",
        name: "Notes",
      }),
    );

    const [stored] = await sourcesById(sourceId);
    expect(stored?.config).not.toHaveProperty("sourceBindingVersion");
  });
  it("server-binds get-or-created GA4 sources and rejects version rewrites", async () => {
    const sourceId = id();
    await commit(
      cmd("GetOrCreateDataSource", {
        id: sourceId,
        type: "googleAnalytics",
        name: "Acquisition",
      }),
    );
    expect((await sourcesById(sourceId))[0]?.config).toMatchObject({
      sourceBindingVersion: "v2",
    });

    await expect(
      commit(
        cmd("SetDataSourceConfig", {
          id: sourceId,
          extra: { sourceBindingVersion: "v1" },
        }),
      ),
    ).rejects.toThrow();
    expect((await sourcesById(sourceId))[0]?.config).toMatchObject({
      sourceBindingVersion: "v2",
    });
  });
  it("should replace only config (not name) for SetDataSourceConfig", async () => {
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
  it("should rename without touching config for RenameNode", async () => {
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
    ).rejects.toThrow();

    const [row] = await tablesById(tableId);
    expect((row?.fields as { id: string }[]).map((f) => f.id)).toEqual([
      fieldId,
    ]);
  });
  it("should stamp dataFrameId and lastFetchedAt for RefreshDataTable", async () => {
    const sourceId = id();
    const tableId = id();
    const frameId = id();
    await makeFrame(frameId);
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
  it("rejects malformed structured DataTable operands before persistence", async () => {
    const sourceId = id();
    await commit(
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
    );

    await expect(
      commit(
        cmd("CreateDataTable", {
          id: id(),
          dataSourceId: sourceId,
          name: "Invalid",
          table: "invalid.csv",
          fields: {} as never,
        }),
      ),
    ).rejects.toThrow();

    for (const malformed of [
      { fields: [42] },
      { metrics: ["bad"] },
      {
        sourceSchema: {
          columns: "bad",
          version: 1,
          lastSyncedAt: Date.now(),
        },
      },
    ]) {
      await expect(
        commit(
          cmd("CreateDataTable", {
            id: id(),
            dataSourceId: sourceId,
            name: "Invalid nested state",
            table: "invalid-nested.csv",
            ...malformed,
          } as never),
        ),
      ).rejects.toThrow();
    }

    const tableId = id();
    await commit(
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "Valid",
        table: "valid.csv",
      }),
    );
    await expect(
      commit(
        cmd("SetDataTableSchema", {
          id: tableId,
          sourceSchema: [] as never,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("AddField", {
          nodeId: tableId,
          field: { id: id() } as never,
        }),
      ),
    ).rejects.toThrow();
    expect((await tablesById(tableId))[0]?.sourceSchema).toBeNull();
    expect((await tablesById(tableId))[0]?.fields).toEqual([]);
  });
  it("rejects dangling dataFrameId references in CreateDataTable and RefreshDataTable", async () => {
    const sourceId = id();
    const tableId = id();
    const missingFrameId = id();
    await commit(
      cmd("CreateDataSource", { id: sourceId, type: "csv", name: "S" }),
    );

    await expect(
      commit(
        cmd("CreateDataTable", {
          id: id(),
          dataSourceId: sourceId,
          name: "Dangling",
          table: "dangling.csv",
          dataFrameId: missingFrameId,
        }),
      ),
    ).rejects.toThrow();

    await commit(
      cmd("CreateDataTable", {
        id: tableId,
        dataSourceId: sourceId,
        name: "T",
        table: "t.csv",
      }),
    );
    await expect(
      commit(
        cmd("RefreshDataTable", {
          id: tableId,
          dataFrameId: missingFrameId,
        }),
      ),
    ).rejects.toThrow();
    expect((await tablesById(tableId))[0]?.dataFrameId).toBeNull();
  });
  it("should replace the source schema slice for SetDataTableSchema", async () => {
    const sourceId = id();
    const tableId = id();
    const sourceSchema = {
      columns: [{ name: "amount", type: "number" }],
      version: 1,
      lastSyncedAt: 1,
    };
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
          tableId,
          columnName: "amount",
          aggregation: "sum",
        },
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
          tableId,
          columnName: "amount",
          aggregation: "sum",
        },
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
        metric: {
          id: metricId,
          name: "Sum",
          tableId,
          columnName: "amount",
          aggregation: "sum",
        },
      }),
    );

    await expect(
      commit(
        cmd("AddMetric", {
          nodeId: tableId,
          metric: {
            id: metricId,
            name: "Sum again",
            tableId,
            columnName: "amount",
            aggregation: "sum",
          },
        }),
      ),
    ).rejects.toThrow();

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
    ).rejects.toThrow();
  });
  it("should throw on a missing id for RefreshDataTable (no silent no-op)", async () => {
    await expect(
      commit(cmd("RefreshDataTable", { id: id(), dataFrameId: id() })),
    ).rejects.toThrow();
  });
  it("should throw on a missing id for RenameNode (no silent no-op)", async () => {
    await expect(
      commit(cmd("RenameNode", { id: id(), name: "X" })),
    ).rejects.toThrow();
  });
  it("should throw on a missing id for SetDataSourceConfig (no silent no-op)", async () => {
    await expect(
      commit(cmd("SetDataSourceConfig", { id: id(), apiKey: "x" })),
    ).rejects.toThrow();
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
    ).rejects.toThrow();
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
    ).rejects.toThrow();
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
  it("SetDataSourceConfig extra: a REST connector config shape lands in config unstripped", async () => {
    // The assistant authors a REST data source by writing the declarative
    // connector config through `extra`. None of these keys are credentials, so
    // the sink guard must let the whole REST shape through to config — only the
    // typed apiKey/connectionString fields are rejected from `extra`.
    const sourceId = id();
    await commit(
      cmd("CreateDataSource", { id: sourceId, type: "rest", name: "GitHub" }),
    );
    await commit(
      cmd("SetDataSourceConfig", {
        id: sourceId,
        extra: {
          endpoint: "https://api.github.com/users",
          method: "GET",
          authRef: "secret-ref-123",
          pagination: "cursor",
          rowPath: "data",
          fieldMap: { login: "username" },
        } as Record<string, unknown>,
      }),
    );
    const [row] = await sourcesById(sourceId);
    const stored = row?.config as Record<string, unknown>;
    expect(stored["endpoint"]).toBe("https://api.github.com/users");
    expect(stored["method"]).toBe("GET");
    // authRef is a SecretRef (an opaque id), NOT a plaintext credential — it is
    // a reference the agent may author; it carries no secret value.
    expect(stored["authRef"]).toBe("secret-ref-123");
    expect(stored["pagination"]).toBe("cursor");
    expect(stored["rowPath"]).toBe("data");
    expect(stored["fieldMap"]).toEqual({ login: "username" });
    // No credential slots were touched.
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
    ).rejects.toThrow();
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
    ).rejects.toThrow();
  });
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
      source: { sourceType: string; sourceId: string };
    };
    expect(def.source).toEqual({
      sourceType: "dataTable",
      sourceId: tableId,
    });
    expect(def).not.toHaveProperty("baseTableId");
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
  it("rejects data-table field names where selected field ids are required", async () => {
    const { tableId } = await makeTable();
    const fieldId = id();
    const insightId = id();
    await commit(
      cmd("AddField", {
        nodeId: tableId,
        field: {
          id: fieldId,
          name: "Region",
          tableId,
          columnName: "region",
          type: "string",
        },
      }),
    );

    await expect(
      commit(
        cmd("CreateInsight", {
          id: insightId,
          name: "Invalid selection",
          source: { sourceType: "dataTable", sourceId: tableId },
          selectedFields: ["Region"],
        }),
      ),
    ).rejects.toThrow("not output by source");
    expect(await insightsById(insightId)).toHaveLength(0);
  });
  it("rejects a dashboard item whose visualization is absent from its draft", async () => {
    const dashboardId = id();
    await commit(cmd("CreateDashboard", { id: dashboardId, name: "D" }));
    const { draftId } = await draftCommit();

    await expect(
      client.mutation(api.app.draftBatch, {
        draftId,
        commands: [
          cmd("AddDashboardItem", {
            dashboardId,
            item: {
              id: id(),
              type: "visualization",
              visualizationId: id(),
              x: 0,
              y: 0,
              width: 6,
              height: 4,
            },
          }),
        ],
      }),
    ).rejects.toThrow("visualization");
  });
  it("accepts a visualization from the addressed draft but rejects one from another draft", async () => {
    const { tableId } = await makeTable();
    const insightId = id();
    const visualizationId = id();
    const dashboardId = id();
    await commit(cmd("CreateDashboard", { id: dashboardId, name: "D" }));
    const own = await draftCommit(
      cmd("CreateInsight", {
        id: insightId,
        name: "Draft insight",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );
    await client.mutation(api.app.draftBatch, {
      draftId: own.draftId,
      commands: [
        cmd("CreateVisualization", {
          id: visualizationId,
          name: "Draft chart",
          insightId,
          visualizationType: "barY",
          encoding: {},
          spec: {},
        }),
      ],
    });
    await expect(
      client.mutation(api.app.draftBatch, {
        draftId: own.draftId,
        commands: [
          cmd("AddDashboardItem", {
            dashboardId,
            item: {
              id: id(),
              type: "visualization",
              visualizationId,
              x: 0,
              y: 0,
              width: 6,
              height: 4,
            },
          }),
        ],
      }),
    ).resolves.toMatchObject({ draftId: own.draftId });

    const foreign = await draftCommit();
    await expect(
      client.mutation(api.app.draftBatch, {
        draftId: foreign.draftId,
        commands: [
          cmd("AddDashboardItem", {
            dashboardId,
            item: {
              id: id(),
              type: "visualization",
              visualizationId,
              x: 0,
              y: 0,
              width: 6,
              height: 4,
            },
          }),
        ],
      }),
    ).rejects.toThrow("visualization");
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
    ).rejects.toThrow();
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
    ).rejects.toThrow();
    expect(await insightsById(insightId)).toHaveLength(0);
  });
  it("returns the existing unmodified draft for the same table", async () => {
    const { tableId } = await makeTable();
    const firstId = id();
    const secondId = id();

    const first = await commit(
      cmd("GetOrCreateInsightDraft", {
        id: firstId,
        name: "Orders",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );
    const second = await commit(
      cmd("GetOrCreateInsightDraft", {
        id: secondId,
        name: "Orders",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );

    expect(first.results[0]?.value).toEqual({ id: firstId });
    expect(second.results[0]?.value).toEqual({ id: firstId });
    expect(await insightsById(firstId)).toHaveLength(1);
    expect(await insightsById(secondId)).toHaveLength(0);
  });
  it("does not reuse a modified insight", async () => {
    const { tableId } = await makeTable();
    const modifiedId = id();
    const draftId = id();
    await commit(
      cmd("CreateInsight", {
        id: modifiedId,
        name: "Orders",
        source: { sourceType: "dataTable", sourceId: tableId },
        selectedFields: [id()],
      }),
    );

    const result = await commit(
      cmd("GetOrCreateInsightDraft", {
        id: draftId,
        name: "Orders (2)",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );

    expect(result.results[0]?.value).toEqual({ id: draftId });
    expect(await insightsById(draftId)).toHaveLength(1);
  });
  it("atomically moves selected fields with their source", async () => {
    const first = await makeTable();
    const second = await makeTable();
    const firstFieldId = id();
    const secondFieldId = id();
    const insightId = id();
    await commit(
      cmd("AddField", {
        nodeId: first.tableId,
        field: {
          id: firstFieldId,
          name: "First",
          tableId: first.tableId,
          columnName: "first",
          type: "string",
        },
      }),
      cmd("AddField", {
        nodeId: second.tableId,
        field: {
          id: secondFieldId,
          name: "Second",
          tableId: second.tableId,
          columnName: "second",
          type: "string",
        },
      }),
      cmd("CreateInsight", {
        id: insightId,
        name: "Moving",
        source: { sourceType: "dataTable", sourceId: first.tableId },
        selectedFields: [firstFieldId],
      }),
    );
    const current = {
      id: insightId,
      name: "Moving",
      source: { sourceType: "dataTable", sourceId: first.tableId },
      selectedFields: [firstFieldId],
      metrics: [],
      filters: [],
      sorts: [],
      joins: [],
      createdAt: 0,
    } as Insight;

    await commit(
      ...buildInsightUpdateCommands(insightId, current, {
        source: { sourceType: "dataTable", sourceId: second.tableId },
        selectedFields: [secondFieldId],
      }),
    );

    const [stored] = await insightsById(insightId);
    expect(stored?.definition).toMatchObject({
      source: { sourceType: "dataTable", sourceId: second.tableId },
      selectedFields: [secondFieldId],
    });
  });
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
  it("rejects fields that the immediate source Insight does not output", async () => {
    const { tableId } = await makeTable();
    const outputFieldId = id();
    const rootOnlyFieldId = id();
    const upstreamId = id();
    const derivedId = id();
    const invalidCreateId = id();
    const rebindId = id();
    await commit(
      cmd("AddField", {
        nodeId: tableId,
        field: {
          id: outputFieldId,
          name: "Output field",
          tableId,
          columnName: "output",
          type: "number",
        },
      }),
      cmd("AddField", {
        nodeId: tableId,
        field: {
          id: rootOnlyFieldId,
          name: "Root-only field",
          tableId,
          columnName: "root_only",
          type: "number",
        },
      }),
      cmd("CreateInsight", {
        id: upstreamId,
        name: "Upstream",
        source: { sourceType: "dataTable", sourceId: tableId },
        selectedFields: [outputFieldId],
      }),
      cmd("CreateInsight", {
        id: derivedId,
        name: "Derived",
        source: { sourceType: "insight", sourceId: upstreamId },
      }),
      cmd("CreateInsight", {
        id: rebindId,
        name: "Rebind",
        source: { sourceType: "dataTable", sourceId: tableId },
        selectedFields: [rootOnlyFieldId],
      }),
    );

    await expect(
      commit(
        cmd("CreateInsight", {
          id: invalidCreateId,
          name: "Invalid derived",
          source: { sourceType: "insight", sourceId: upstreamId },
          selectedFields: [rootOnlyFieldId],
        }),
      ),
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("SelectFields", {
          id: derivedId,
          fieldIds: [rootOnlyFieldId],
        }),
      ),
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("AddField", {
          nodeId: derivedId,
          field: {
            id: rootOnlyFieldId,
            name: "Root-only field",
            tableId,
            type: "number",
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("SetInsightSource", {
          id: rebindId,
          source: { sourceType: "insight", sourceId: upstreamId },
        }),
      ),
    ).rejects.toThrow();

    await commit(
      cmd("SelectFields", {
        id: derivedId,
        fieldIds: [outputFieldId],
      }),
    );
    const [derived] = await insightsById(derivedId);
    expect(
      (derived?.definition as { selectedFields: string[] }).selectedFields,
    ).toEqual([outputFieldId]);
    expect(await insightsById(invalidCreateId)).toHaveLength(0);
    expect((await insightsById(rebindId))[0]?.definition).toMatchObject({
      source: { sourceType: "dataTable", sourceId: tableId },
      selectedFields: [rootOnlyFieldId],
    });
  });
  it("rejects derived metric, filter, and sort references outside the immediate source output", async () => {
    const { tableId } = await makeTable();
    const outputFieldId = id();
    const rootOnlyFieldId = id();
    const upstreamId = id();
    const derivedId = id();
    const invalidCreateId = id();
    const wrongSourceCreateId = id();
    const rebindId = id();
    const outputColumn = fieldIdToColumnAlias(outputFieldId);
    const rootOnlyColumn = fieldIdToColumnAlias(rootOnlyFieldId);
    await commit(
      cmd("AddField", {
        nodeId: tableId,
        field: {
          id: outputFieldId,
          name: "Output field",
          tableId,
          columnName: "output",
          type: "number",
        },
      }),
      cmd("AddField", {
        nodeId: tableId,
        field: {
          id: rootOnlyFieldId,
          name: "Root-only field",
          tableId,
          columnName: "root_only",
          type: "number",
        },
      }),
      cmd("CreateInsight", {
        id: upstreamId,
        name: "Upstream",
        source: { sourceType: "dataTable", sourceId: tableId },
        selectedFields: [outputFieldId],
      }),
      cmd("CreateInsight", {
        id: derivedId,
        name: "Derived",
        source: { sourceType: "insight", sourceId: upstreamId },
        selectedFields: [outputFieldId],
      }),
      cmd("CreateInsight", {
        id: rebindId,
        name: "Rebind",
        source: { sourceType: "dataTable", sourceId: tableId },
        metrics: [
          {
            id: id(),
            name: "Root-only sum",
            sourceTable: tableId,
            columnName: "root_only",
            aggregation: "sum",
          },
        ],
      }),
    );

    await expect(
      commit(
        cmd("CreateInsight", {
          id: invalidCreateId,
          name: "Invalid derived",
          source: { sourceType: "insight", sourceId: upstreamId },
          metrics: [
            {
              id: id(),
              name: "Invalid sum",
              sourceTable: upstreamId,
              columnName: rootOnlyColumn,
              aggregation: "sum",
            },
          ],
        }),
      ),
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("CreateInsight", {
          id: wrongSourceCreateId,
          name: "Wrong source derived",
          source: { sourceType: "insight", sourceId: upstreamId },
          metrics: [
            {
              id: id(),
              name: "Wrong source sum",
              sourceTable: tableId,
              columnName: outputColumn,
              aggregation: "sum",
            },
          ],
        }),
      ),
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("SetInsightSource", {
          id: rebindId,
          source: { sourceType: "insight", sourceId: upstreamId },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("AddMetric", {
          nodeId: derivedId,
          metric: {
            id: id(),
            name: "Invalid sum",
            sourceTable: upstreamId,
            columnName: rootOnlyColumn,
            aggregation: "sum",
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("AddMetric", {
          nodeId: derivedId,
          metric: {
            id: id(),
            name: "Wrong source sum",
            sourceTable: tableId,
            columnName: outputColumn,
            aggregation: "sum",
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("SetInsightFilter", {
          id: derivedId,
          filters: [{ field: rootOnlyColumn, operator: "gt", value: 100 }],
        }),
      ),
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("SetInsightSort", {
          id: derivedId,
          sorts: [{ field: rootOnlyColumn, direction: "desc" }],
        }),
      ),
    ).rejects.toThrow();

    const metricId = id();
    await commit(
      cmd("AddMetric", {
        nodeId: derivedId,
        metric: {
          id: metricId,
          name: "Valid sum",
          sourceTable: upstreamId,
          columnName: outputColumn,
          aggregation: "sum",
        },
      }),
      cmd("SetInsightFilter", {
        id: derivedId,
        filters: [{ field: outputColumn, operator: "gt", value: 100 }],
      }),
      cmd("SetInsightSort", {
        id: derivedId,
        sorts: [{ field: outputColumn, direction: "desc" }],
      }),
    );
    expect((await insightsById(derivedId))[0]?.definition).toMatchObject({
      selectedFields: [outputFieldId],
      metrics: [{ id: metricId, columnName: outputColumn }],
      filters: [{ field: outputColumn }],
      sorts: [{ field: outputColumn }],
    });
    expect(await insightsById(invalidCreateId)).toHaveLength(0);
    expect(await insightsById(wrongSourceCreateId)).toHaveLength(0);
    expect((await insightsById(rebindId))[0]?.definition).toMatchObject({
      source: { sourceType: "dataTable", sourceId: tableId },
      metrics: [{ columnName: "root_only" }],
    });
  });
  it("preserves valid derived pass-through sorts and blocks field edits that strand them", async () => {
    const { tableId } = await makeTable();
    const firstFieldId = id();
    const secondFieldId = id();
    const upstreamId = id();
    const derivedId = id();
    const firstColumn = fieldIdToColumnAlias(firstFieldId);
    await commit(
      cmd("AddField", {
        nodeId: tableId,
        field: {
          id: firstFieldId,
          name: "First",
          tableId,
          columnName: "first",
          type: "string",
        },
      }),
      cmd("AddField", {
        nodeId: tableId,
        field: {
          id: secondFieldId,
          name: "Second",
          tableId,
          columnName: "second",
          type: "string",
        },
      }),
      cmd("CreateInsight", {
        id: upstreamId,
        name: "Upstream",
        source: { sourceType: "dataTable", sourceId: tableId },
        selectedFields: [firstFieldId, secondFieldId],
      }),
      cmd("CreateInsight", {
        id: derivedId,
        name: "Derived",
        source: { sourceType: "insight", sourceId: upstreamId },
      }),
      cmd("SetInsightSort", {
        id: derivedId,
        sorts: [{ field: firstColumn, direction: "asc" }],
      }),
      cmd("SelectFields", {
        id: derivedId,
        fieldIds: [firstFieldId, secondFieldId],
      }),
    );

    await expect(
      commit(
        cmd("SelectFields", {
          id: derivedId,
          fieldIds: [secondFieldId],
        }),
      ),
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("RemoveField", {
          nodeId: derivedId,
          fieldId: firstFieldId,
        }),
      ),
    ).rejects.toThrow();
    expect((await insightsById(derivedId))[0]?.definition).toMatchObject({
      selectedFields: [firstFieldId, secondFieldId],
      sorts: [{ field: firstColumn, direction: "asc" }],
    });

    const metricId = id();
    await commit(
      cmd("AddMetric", {
        nodeId: derivedId,
        metric: {
          id: metricId,
          name: "Count",
          sourceTable: upstreamId,
          aggregation: "count",
        },
      }),
      cmd("SetInsightSort", {
        id: derivedId,
        sorts: [{ field: metricIdToColumnAlias(metricId), direction: "desc" }],
      }),
    );
    await expect(
      commit(cmd("RemoveMetric", { nodeId: derivedId, metricId })),
    ).rejects.toThrow();
  });
  it("accepts current derived joins and blocks removing a referenced join", async () => {
    const { tableId } = await makeTable();
    const { tableId: joinedTableId } = await makeTable();
    const baseKeyId = id();
    const joinedKeyId = id();
    const joinedValueId = id();
    const upstreamId = id();
    const derivedId = id();
    await commit(
      cmd("AddField", {
        nodeId: tableId,
        field: {
          id: baseKeyId,
          name: "Region ID",
          tableId,
          columnName: "region_id",
          type: "string",
        },
      }),
      cmd("AddField", {
        nodeId: joinedTableId,
        field: {
          id: joinedKeyId,
          name: "ID",
          tableId: joinedTableId,
          columnName: "id",
          type: "string",
        },
      }),
      cmd("AddField", {
        nodeId: joinedTableId,
        field: {
          id: joinedValueId,
          name: "Region",
          tableId: joinedTableId,
          columnName: "region",
          type: "string",
        },
      }),
      cmd("CreateInsight", {
        id: upstreamId,
        name: "Upstream",
        source: { sourceType: "dataTable", sourceId: tableId },
        selectedFields: [baseKeyId],
      }),
      cmd("CreateInsight", {
        id: derivedId,
        name: "Derived",
        source: { sourceType: "insight", sourceId: upstreamId },
      }),
      cmd("AddJoin", {
        id: derivedId,
        join: {
          type: "left",
          rightTableId: joinedTableId,
          leftKey: fieldIdToColumnAlias(baseKeyId),
          rightKey: "id",
        },
      }),
      cmd("AddField", {
        nodeId: derivedId,
        field: {
          id: joinedValueId,
          name: "Region",
          tableId: joinedTableId,
          columnName: "region",
          type: "string",
        },
      }),
    );

    await expect(
      commit(cmd("RemoveJoin", { id: derivedId, joinIndex: 0 })),
    ).rejects.toThrow();
    expect((await insightsById(derivedId))[0]?.definition).toMatchObject({
      selectedFields: [joinedValueId],
      joins: [{ rightTableId: joinedTableId }],
    });
  });
  it("accepts canonical joined fields emitted by an unconfigured source Insight", async () => {
    const { tableId } = await makeTable();
    const { tableId: joinedTableId } = await makeTable();
    const baseKeyId = id();
    const secondBaseKeyId = id();
    const joinedKeyId = id();
    const joinedValueId = id();
    const repeatJoinedValueId = `${joinedValueId}_j1` as ReturnType<typeof id>;
    const upstreamId = id();
    const derivedId = id();
    const repeatedDerivedId = id();
    await commit(
      cmd("AddField", {
        nodeId: tableId,
        field: {
          id: baseKeyId,
          name: "Customer ID",
          tableId,
          columnName: "customer_id",
          type: "string",
        },
      }),
      cmd("AddField", {
        nodeId: tableId,
        field: {
          id: secondBaseKeyId,
          name: "Approver ID",
          tableId,
          columnName: "approver_id",
          type: "string",
        },
      }),
      cmd("AddField", {
        nodeId: joinedTableId,
        field: {
          id: joinedKeyId,
          name: "ID",
          tableId: joinedTableId,
          columnName: "id",
          type: "string",
        },
      }),
      cmd("AddField", {
        nodeId: joinedTableId,
        field: {
          id: joinedValueId,
          name: "Segment",
          tableId: joinedTableId,
          columnName: "segment",
          type: "string",
        },
      }),
      cmd("CreateInsight", {
        id: upstreamId,
        name: "Joined upstream",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
      cmd("AddJoin", {
        id: upstreamId,
        join: {
          type: "left",
          rightTableId: joinedTableId,
          leftKey: "customer_id",
          rightKey: "id",
        },
      }),
      cmd("AddJoin", {
        id: upstreamId,
        join: {
          type: "left",
          rightTableId: joinedTableId,
          leftKey: "approver_id",
          rightKey: "id",
        },
      }),
      cmd("CreateInsight", {
        id: derivedId,
        name: "Derived",
        source: { sourceType: "insight", sourceId: upstreamId },
        selectedFields: [joinedValueId],
      }),
      cmd("CreateInsight", {
        id: repeatedDerivedId,
        name: "Repeat-join derived",
        source: { sourceType: "insight", sourceId: upstreamId },
        selectedFields: [repeatJoinedValueId],
      }),
    );

    expect((await insightsById(derivedId))[0]?.definition).toMatchObject({
      selectedFields: [joinedValueId],
    });
    expect(
      (await insightsById(repeatedDerivedId))[0]?.definition,
    ).toMatchObject({ selectedFields: [repeatJoinedValueId] });
    await expect(
      commit(
        cmd("SelectFields", {
          id: derivedId,
          fieldIds: [joinedKeyId],
        }),
      ),
    ).rejects.toThrow();
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
    ).rejects.toThrow();
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
    ).rejects.toThrow();

    // A's source should still be B (the rollback worked).
    const aRows = await insightsById(aId);
    const def = aRows[0]?.definition as { source: { sourceId: string } };
    expect(def.source.sourceId).toBe(bId);
  });
  it("should preserve the cycle guard after updateInsight renames a composed insight", async () => {
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
    await commit(
      cmd("SetInsightSource", {
        id: bId,
        source: { sourceType: "insight", sourceId: aId },
      }),
    );

    await commit(cmd("RenameNode", { id: bId, name: "B renamed" }));

    await expect(
      commit(
        cmd("SetInsightSource", {
          id: aId,
          source: { sourceType: "insight", sourceId: bId },
        }),
      ),
    ).rejects.toThrow();

    const aRows = await insightsById(aId);
    const definition = aRows[0]?.definition as {
      source: { sourceType: string; sourceId: string };
    };
    expect(definition.source).toEqual({
      sourceType: "dataTable",
      sourceId: tableId,
    });
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
    ).rejects.toThrow();
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
    ).rejects.toThrow();

    // The original dataTable source must be intact (the write rolled back).
    const rows = await insightsById(insightId);
    const def = rows[0]?.definition as { source: { sourceId: string } };
    expect(def.source.sourceId).toBe(tableId);
  });
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
  it("persists ids for agent-created filters that omit them", async () => {
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
    const def = rows[0]?.definition as {
      filters: Array<(typeof filters)[number] & { id: string }>;
    };
    expect(def.filters).toEqual([{ ...filters[0], id: expect.any(String) }]);
  });
  it("preserves a filter id supplied by an API caller", async () => {
    const { tableId } = await makeTable();
    const insightId = id();
    await commit(
      cmd("CreateInsight", {
        id: insightId,
        name: "I",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );

    await commit(
      cmd("SetInsightFilter", {
        id: insightId,
        filters: [
          {
            id: "agent-filter-id",
            field: "region",
            operator: "eq",
            value: { kind: "value", v: "EMEA" },
          },
        ],
      }),
    );

    const rows = await insightsById(insightId);
    const def = rows[0]?.definition as {
      filters: Array<{ id: string }>;
    };
    expect(def.filters[0]?.id).toBe("agent-filter-id");
  });
  it("stores late-bound operands in drafts without changing canonical filters", async () => {
    const { tableId } = await makeTable(),
      insightId = id();
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
        value: {
          kind: "lateBound" as const,
          ref: { type: "category" as const, handle: "region" },
        },
      },
    ];
    const { draftId } = await client.mutation(api.app.draftBatch, {
      commands: [cmd("SetInsightFilter", { id: insightId, filters })],
    });
    expect(
      (await client.query(api.app.getInsight, { id: insightId, draftId }))
        ?.filters?.[0]?.value,
    ).toEqual(filters[0]!.value);
    expect(
      (await client.query(api.app.getInsight, { id: insightId }))?.filters,
    ).toEqual([]);
  });

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
  it("persists only declarations targeting saved filters and result fields", async () => {
    const { tableId } = await makeTable();
    const insightId = id();
    const fieldId = id();
    await commit(
      cmd("CreateInsight", {
        id: insightId,
        name: "I",
        source: { sourceType: "dataTable", sourceId: tableId },
        selectedFields: [fieldId],
      }),
    );
    await commit(
      cmd("SetInsightFilter", {
        id: insightId,
        filters: [
          {
            id: "region-filter",
            field: "region",
            operator: "eq",
            value: { kind: "value", v: "EMEA" },
          },
        ],
      }),
    );
    const runtimeControls = {
      filters: [
        {
          key: "region",
          filterId: "region-filter",
          label: "Region",
        },
      ],
      sort: { allowedFieldIds: [fieldId], maxKeys: 1 as const },
      limit: { min: 1, max: 100 },
    };
    await commit(
      cmd("SetInsightRuntimeControls", { id: insightId, runtimeControls }),
    );
    const def = (await insightsById(insightId))[0]?.definition as {
      runtimeControls: typeof runtimeControls;
    };
    expect(def.runtimeControls).toEqual(runtimeControls);

    await commit(cmd("SelectFields", { id: insightId, fieldIds: [] }));
    const afterFieldRemoval = (await insightsById(insightId))[0]
      ?.definition as {
      runtimeControls: {
        filters?: unknown[];
        sort?: unknown;
        limit?: unknown;
      };
    };
    expect(afterFieldRemoval.runtimeControls).toEqual({
      filters: runtimeControls.filters,
      limit: runtimeControls.limit,
    });

    await commit(cmd("SetInsightFilter", { id: insightId, filters: [] }));
    const afterFilterRemoval = (await insightsById(insightId))[0]
      ?.definition as { runtimeControls: { limit?: unknown } };
    expect(afterFilterRemoval.runtimeControls).toEqual({
      limit: runtimeControls.limit,
    });

    await expect(
      commit(
        cmd("SetInsightRuntimeControls", {
          id: insightId,
          runtimeControls: {
            filters: [
              { key: "missing", filterId: "missing", label: "Missing" },
            ],
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("SetInsightRuntimeControls", {
          id: insightId,
          runtimeControls: {
            filters: [
              {
                key: "region",
                filterId: "region-filter",
                label: "Region",
                required: true,
                allowClear: true,
              },
            ],
          },
        }),
      ),
    ).rejects.toThrow();
  });
  it("should reject a non-string element inside selectedFields", async () => {
    // `selectedFields` is typed `z.array(z.string())`, so element validation
    // is real here — unlike `filters`/`sorts`/`metrics`, whose elements are
    // deliberately opaque at this layer (see the insights codec header).
    const insightId = await makeInsight();
    const before = await storedDefinition(insightId);

    await expect(
      commit(rawCmd("SelectFields", { id: insightId, fieldIds: [id(), 42] })),
    ).rejects.toThrow();
    expect(await storedDefinition(insightId)).toBe(before);
  });
  it("should round-trip valid operands unchanged, including empty arrays", async () => {
    const insightId = await makeInsight();
    const fieldA = id();

    await commit(
      cmd("SelectFields", { id: insightId, fieldIds: [fieldA] }),
      cmd("SetInsightSort", {
        id: insightId,
        sorts: [{ field: "amount", direction: "desc" }],
      }),
    );
    const rows = await insightsById(insightId);
    const def = rows[0]?.definition as {
      selectedFields: unknown;
      sorts: unknown;
    };
    // Pin the type before comparing: an `as` cast over a missing key would
    // otherwise make `toEqual` compare undefined to undefined and pass green.
    expect(Array.isArray(def.selectedFields)).toBe(true);
    expect(def.selectedFields).toEqual([fieldA]);
    expect(Array.isArray(def.sorts)).toBe(true);
    expect(def.sorts).toEqual([{ field: "amount", direction: "desc" }]);

    // Empty arrays are a valid "nothing set", distinct from a rejected
    // operand — parsing must not coerce them away or treat them as absent.
    await commit(
      cmd("SelectFields", { id: insightId, fieldIds: [] }),
      cmd("SetInsightSort", { id: insightId, sorts: [] }),
    );
    const cleared = (await insightsById(insightId))[0]?.definition as {
      selectedFields: unknown;
      sorts: unknown;
    };
    expect(Array.isArray(cleared.selectedFields)).toBe(true);
    expect(cleared.selectedFields).toEqual([]);
    expect(Array.isArray(cleared.sorts)).toBe(true);
    expect(cleared.sorts).toEqual([]);
  });
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
    ).rejects.toThrow();

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
    ).rejects.toThrow();

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
    ).rejects.toThrow();
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
    ).rejects.toThrow();
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
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("UpdateJoin", {
          id: insightId,
          joinIndex: 0.5,
          updates: { type: "left" },
        }),
      ),
    ).rejects.toThrow();
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
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("RemoveJoin", {
          id: insightId,
          joinIndex: "0" as unknown as number,
        }),
      ),
    ).rejects.toThrow();
  });
  it("should add the field id to selectedFields (the array the read path surfaces), not a phantom definition.fields", async () => {
    // Regression: AddField on an Insight wrote `definition.fields` (an array of
    // Field objects), but decodeInsight surfaces `definition.selectedFields`
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
    ).rejects.toThrow();
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
    ).rejects.toThrow();
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
    ).rejects.toThrow();
  });
  it("rejects unsupported aggregations and missing non-count columns", async () => {
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
          metric: {
            id: id(),
            name: "Broken",
            sourceTable: tableId,
            aggregation: "median",
            columnName: "amount",
          } as never,
        }),
      ),
    ).rejects.toThrow();

    await expect(
      commit(
        cmd("AddMetric", {
          nodeId: insightId,
          metric: {
            id: id(),
            name: "Broken",
            sourceTable: tableId,
            aggregation: "sum",
          } as never,
        }),
      ),
    ).rejects.toThrow();

    await expect(
      commit(
        cmd("AddMetric", {
          nodeId: insightId,
          metric: {
            id: id(),
            name: "Broken count",
            sourceTable: tableId,
            aggregation: "count",
            columnName: 42,
          } as never,
        }),
      ),
    ).rejects.toThrow();
  });
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
    ).rejects.toThrow();

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

    await commit(cmd("SetChartType", { id: vizId, visualizationType: "line" }));
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

    const encoding = {
      x: "field:550e8400-e29b-41d4-a716-446655440000",
      y: "metric:6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    } as never;
    await commit(cmd("SetChartEncoding", { id: vizId, encoding }));
    const rows = await vizsById(vizId);
    expect(rows[0]?.encoding).toEqual(encoding);
  });
  it("should throw on SetChartType for a missing visualization (no silent no-op)", async () => {
    await expect(
      commit(cmd("SetChartType", { id: id(), visualizationType: "line" })),
    ).rejects.toThrow();
  });
  it("should throw on SetChartEncoding for a missing visualization (no silent no-op)", async () => {
    await expect(
      commit(cmd("SetChartEncoding", { id: id(), encoding: {} as never })),
    ).rejects.toThrow();
  });
  it("should reject a structurally malformed encoding on SetChartEncoding, naming the format", async () => {
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

    await expect(
      commit(
        cmd("SetChartEncoding", {
          id: vizId,
          encoding: { x: { field: "region" } } as never,
        }),
      ),
    ).rejects.toThrow();

    // Nothing was written — the visualization keeps its original encoding.
    const rows = await vizsById(vizId);
    expect(rows[0]?.encoding).toEqual({});
  });
  it("should accept a bare column name — a form the axis picker still writes", async () => {
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

    const encoding = { x: "region", y: "sum(amount)" };
    await commit(
      cmd("SetChartEncoding", { id: vizId, encoding: encoding as never }),
    );
    expect((await vizsById(vizId))[0]?.encoding).toEqual(encoding);
  });
  it("should accept a cleared optional channel — the picker saves an empty string", async () => {
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
        visualizationType: "dot",
        spec: {},
      }),
    );

    const encoding = { x: "region", y: "sum(amount)", color: "", size: "" };
    await commit(
      cmd("SetChartEncoding", { id: vizId, encoding: encoding as never }),
    );
    expect((await vizsById(vizId))[0]?.encoding).toEqual(encoding);
  });
  it("should reject a value that claims to be an ID reference but carries no uuid", async () => {
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

    await expect(
      commit(
        cmd("SetChartEncoding", {
          id: vizId,
          encoding: { x: "field:not-a-uuid" } as never,
        }),
      ),
    ).rejects.toThrow();
  });
  it("should reject a half-built date transform", async () => {
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

    await expect(
      commit(
        cmd("SetChartEncoding", {
          id: vizId,
          encoding: {
            x: "field:550e8400-e29b-41d4-a716-446655440000",
            xTransform: { type: "date" },
          } as never,
        }),
      ),
    ).rejects.toThrow();
  });
  it("should reject a malformed encoding on CreateVisualization — nothing is inserted", async () => {
    const { tableId } = await makeTable();
    const insightId = id();
    const vizId = id();
    await commit(
      cmd("CreateInsight", {
        id: insightId,
        name: "I",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
    );

    await expect(
      commit(
        cmd("CreateVisualization", {
          id: vizId,
          name: "Chart",
          insightId,
          visualizationType: "barY",
          spec: {},
          encoding: { y: { field: "amount" } } as never,
        }),
      ),
    ).rejects.toThrow();

    expect(await vizsById(vizId)).toHaveLength(0);
  });
  it("rejects chart encoding references outside the insight output", async () => {
    const { tableId } = await makeTable();
    const outputFieldId = id();
    const insightId = id();
    const hallucinatedFieldId = id();
    await commit(
      cmd("AddField", {
        nodeId: tableId,
        field: {
          id: outputFieldId,
          name: "Region",
          tableId,
          columnName: "region",
          type: "string",
        },
      }),
      cmd("CreateInsight", {
        id: insightId,
        name: "I",
        source: { sourceType: "dataTable", sourceId: tableId },
        selectedFields: [outputFieldId],
      }),
    );

    for (const [visualizationId, x] of [
      [id(), `field:${hallucinatedFieldId}`],
      [id(), "missing_column"],
    ])
      await expect(
        draftCommit(
          cmd("CreateVisualization", {
            id: visualizationId,
            name: "Broken chart",
            insightId,
            visualizationType: "barY",
            encoding: { x } as never,
            spec: {},
          }),
        ),
      ).rejects.toThrow("not output by Insight");
  });
  it("should accept a repeat-join instance encoding — the axis picker emits it", async () => {
    const { tableId } = await makeTable();
    const insightId = id();
    const vizId = id();
    const encoding = {
      x: "field:550e8400-e29b-41d4-a716-446655440000_j1",
      y: "metric:6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    };
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
        encoding: encoding as never,
      }),
    );
    const rows = await vizsById(vizId);
    expect(rows[0]?.encoding).toEqual(encoding);
  });
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
  it("places a composed widget after items already staged in the draft", async () => {
    const { tableId } = await makeTable();
    const insightId = id();
    const visualizationId = id();
    const dashboardId = id();
    await commit(
      cmd("CreateInsight", {
        id: insightId,
        name: "I",
        source: { sourceType: "dataTable", sourceId: tableId },
      }),
      cmd("CreateVisualization", {
        id: visualizationId,
        name: "V",
        insightId,
        visualizationType: "barY",
        spec: {},
      }),
      cmd("CreateDashboard", { id: dashboardId, name: "D" }),
    );
    const first = await draftCommit(
      cmd("AddDashboardItem", {
        dashboardId,
        item: {
          id: id(),
          type: "visualization",
          visualizationId,
          x: 0,
          y: 0,
          width: 6,
          height: 4,
        },
      }),
    );
    await client.mutation(api.app.draftBatch, {
      draftId: first.draftId,
      commands: [
        cmd("AddDashboardItem", {
          dashboardId,
          item: {
            id: id(),
            type: "visualization",
            visualizationId,
            x: 0,
            y: 0,
            width: 6,
            height: 4,
          },
        }),
      ],
    });

    const dashboard = await client.query(api.app.getDashboard, {
      id: dashboardId,
      draftId: first.draftId,
    });
    expect(dashboard?.items.map((item) => item.y)).toEqual([0, 4]);
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
    ).rejects.toThrow();
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
  it("preserves a newer item edit when a layout update commits afterward", async () => {
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

    await commit(
      cmd("UpdateDashboardItem", {
        dashboardId: dashId,
        itemId,
        updates: { content: "Concurrent edit" },
      }),
    );
    await commit(
      cmd("UpdateDashboardItem", {
        dashboardId: dashId,
        itemId,
        updates: { x: 5, y: 6, width: 4, height: 2 },
      }),
    );

    const rows = await dashboardsById(dashId);
    const item = (rows[0]?.layout as Record<string, unknown>[])[0];
    expect(item).toMatchObject({
      content: "Concurrent edit",
      x: 5,
      y: 6,
      width: 4,
      height: 2,
    });
  });
  it("rejects whole override-bag replacement through UpdateDashboardItem", async () => {
    const { dashId, sourceItemId: itemId } = await makeDashWithVizItem();

    await expect(
      commit(
        cmd("UpdateDashboardItem", {
          dashboardId: dashId,
          itemId,
          // An untyped client can still send the retired whole-bag shape.
          updates: { overrides: { limit: 5 } } as never,
        }),
      ),
    ).rejects.toThrow();

    const rows = await dashboardsById(dashId);
    const item = (
      rows[0]?.layout as {
        id: string;
        overrides?: unknown;
      }[]
    ).find((it) => it.id === itemId)!;
    expect(item.overrides).toBeUndefined();
  });
  it("serializes concurrent override intents without dropping sibling fields", async () => {
    const { dashId, sourceItemId: itemId } = await makeDashWithVizItem();

    await Promise.all([
      commit(
        cmd("PatchDashboardItemOverride", {
          dashboardId: dashId,
          itemId,
          patch: {
            kind: "sorts",
            value: [{ field: "revenue", direction: "desc" }],
          },
        }),
      ),
      commit(
        cmd("PatchDashboardItemOverride", {
          dashboardId: dashId,
          itemId,
          patch: { kind: "limit", value: 25 },
        }),
      ),
      commit(
        cmd("PatchDashboardItemOverride", {
          dashboardId: dashId,
          itemId,
          patch: {
            kind: "filter",
            field: "region",
            value: { field: "region", operator: "eq", value: "West" },
          },
        }),
      ),
    ]);

    const rows = await dashboardsById(dashId);
    const item = (
      rows[0]?.layout as {
        id: string;
        overrides?: {
          filters?: unknown[];
          sorts?: unknown[];
          limit?: number;
        };
      }[]
    ).find((candidate) => candidate.id === itemId);
    expect(item?.overrides).toEqual({
      filters: [{ field: "region", operator: "eq", value: "West" }],
      sorts: [{ field: "revenue", direction: "desc" }],
      limit: 25,
    });

    await expect(
      commit(
        cmd("PatchDashboardItemOverride", {
          dashboardId: dashId,
          itemId,
          patch: {
            kind: "sorts",
            value: [{ field: "revenue", direction: "sideways" }],
          } as never,
        }),
      ),
    ).rejects.toThrow();

    expect((await dashboardsById(dashId))[0]?.layout).toEqual(rows[0]?.layout);

    await expect(
      commit(
        cmd("PatchDashboardItemOverride", {
          dashboardId: dashId,
          itemId,
          patch: {
            kind: "filter",
            field: "region",
            value: { field: "status", operator: "eq", value: "active" },
          } as never,
        }),
      ),
    ).rejects.toThrow();
  });
  it("normalizes cleared and empty override intents to no override bag", async () => {
    const { dashId, sourceItemId: itemId } = await makeDashWithVizItem();
    await commit(
      cmd("PatchDashboardItemOverride", {
        dashboardId: dashId,
        itemId,
        patch: { kind: "limit", value: 25 },
      }),
      cmd("PatchDashboardItemOverride", {
        dashboardId: dashId,
        itemId,
        patch: { kind: "limit", value: null },
      }),
      cmd("PatchDashboardItemOverride", {
        dashboardId: dashId,
        itemId,
        patch: { kind: "sorts", value: [] },
      }),
    );

    const rows = await dashboardsById(dashId);
    const item = (
      rows[0]?.layout as { id: string; overrides?: unknown }[]
    ).find((candidate) => candidate.id === itemId);
    expect(item?.overrides).toBeUndefined();
  });
  it("should replace dashboard controls through the command vocabulary", async () => {
    const dashId = id();
    const itemId = id();
    const controlId = id();
    await commit(cmd("CreateDashboard", { id: dashId, name: "D" }));

    await commit(
      cmd("SetDashboardControls", {
        dashboardId: dashId,
        controls: [
          {
            id: controlId,
            field: "region",
            label: "Region",
            defaultValue: "West",
            boundInstances: [itemId],
          },
        ],
      }),
    );

    const rows = await dashboardsById(dashId);
    expect(rows[0]?.controls).toEqual([
      {
        id: controlId,
        field: "region",
        label: "Region",
        defaultValue: "West",
        boundInstances: [itemId],
      },
    ]);
  });
  it("rejects malformed dashboard controls before persistence", async () => {
    const dashId = id();
    await commit(cmd("CreateDashboard", { id: dashId, name: "D" }));

    await expect(
      commit(
        cmd("SetDashboardControls", {
          dashboardId: dashId,
          controls: {} as never,
        }),
      ),
    ).rejects.toThrow();
    expect((await dashboardsById(dashId))[0]?.controls).toBeNull();
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
    ).rejects.toThrow();
  });
  it("should reject an AddDashboardItem with a bogus type or non-numeric position (validate before storing)", async () => {
    // Regression: the raw command path only checked item.id and persisted the
    // rest verbatim, so `{ type: "bogus" }` or `{ x: "0" }` could land in
    // dashboards.layout — but readers and layout rendering assume a known type
    // and numeric x/y/width/height. The fix validates the shape at the write
    // canonical full-item command boundary.
    const { vizId } = await makeDashWithVizItem();
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
    ).rejects.toThrow();

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
    ).rejects.toThrow();

    await expect(
      commit(
        cmd("AddDashboardItem", {
          dashboardId: dashId,
          item: {
            id: id(),
            type: "visualization",
            visualizationId: vizId,
            x: 0,
            y: 0,
            width: 3,
            height: 3,
            overrides: {
              filters: [{ field: "region", operator: "bogus", value: "EMEA" }],
            },
          } as never,
        }),
      ),
    ).rejects.toThrow();

    // Neither malformed item persisted.
    const rows = await dashboardsById(dashId);
    expect(rows[0]?.layout as unknown[]).toHaveLength(0);
  });
  it("should reject malformed update fields without partially updating the layout", async () => {
    // Regression: UpdateDashboardItem merged `updates` verbatim, so
    // `{ x: "left", width: null }` corrupted numeric layout coordinates. The fix
    // filters updates to recognized fields with correct primitive types at
    // the canonical command boundary.
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

    await expect(
      commit(
        cmd("UpdateDashboardItem", {
          dashboardId: dashId,
          itemId,
          updates: { x: 9, width: null, content: 5 } as never,
        }),
      ),
    ).rejects.toThrow();

    const rows = await dashboardsById(dashId);
    const item = (rows[0]?.layout as Record<string, unknown>[])[0]!;
    expect(item).toMatchObject({ x: 1, width: 3, content: "A" });
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
    ).rejects.toThrow();
  });
  it("should reject malformed SetDashboardLayout payloads before persistence", async () => {
    const dashId = id();
    await commit(cmd("CreateDashboard", { id: dashId, name: "D" }));

    await expect(
      commit(
        cmd("SetDashboardLayout", {
          dashboardId: dashId,
          items: { id: "not-an-array" } as never,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      commit(
        cmd("SetDashboardLayout", {
          dashboardId: dashId,
          items: [{ id: id() }] as never,
        }),
      ),
    ).rejects.toThrow();

    const rows = await dashboardsById(dashId);
    expect(rows[0]?.layout).toEqual([]);
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
      commit(cmd("RemoveDashboardItem", { dashboardId: dashId, itemId: id() })),
    ).rejects.toThrow();
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
    ).rejects.toThrow();
  });
  it("should emit exactly N new items for N placements, each with the correct field pin", async () => {
    const { dashId, sourceItemId, vizId } = await makeDashWithVizItem();
    const ids = [id(), id(), id()];

    await commit(
      cmd("FanOutDashboardItems", {
        dashboardId: dashId,
        sourceItemId,
        field: "region",
        placements: [
          { id: ids[0]!, value: "EMEA", x: 0, y: 5 },
          { id: ids[1]!, value: "APAC", x: 6, y: 5 },
          { id: ids[2]!, value: "AMER", x: 12, y: 5 },
        ],
      }),
    );

    const [row] = await dashboardsById(dashId);
    const layout = row?.layout as {
      id: string;
      visualizationId: string;
      overrides: {
        filters: { field: string; operator: string; value: unknown }[];
      };
    }[];

    // Source item is still there → total = 1 (source) + 3 (clones).
    expect(layout).toHaveLength(4);

    // All three clone ids are present.
    for (const cloneId of ids) {
      expect(layout.map((it) => it.id)).toContain(cloneId);
    }

    // Each clone shares the source visualizationId.
    for (const cloneId of ids) {
      const clone = layout.find((it) => it.id === cloneId)!;
      expect(clone.visualizationId).toBe(vizId);
    }

    // Each clone pins the field to the correct value (order follows placements).
    const cloneByValue = (v: unknown) =>
      layout.find(
        (it) =>
          it.overrides?.filters?.some(
            (f) => f.field === "region" && f.value === v,
          ) ?? false,
      );
    expect(cloneByValue("EMEA")?.id).toBe(ids[0]);
    expect(cloneByValue("APAC")?.id).toBe(ids[1]);
    expect(cloneByValue("AMER")?.id).toBe(ids[2]);
  });
  it("should use operator 'eq' for all pinned filters", async () => {
    const { dashId, sourceItemId } = await makeDashWithVizItem();
    const cloneId = id();

    await commit(
      cmd("FanOutDashboardItems", {
        dashboardId: dashId,
        sourceItemId,
        field: "status",
        placements: [{ id: cloneId, value: "active", x: 0, y: 8 }],
      }),
    );

    const [row] = await dashboardsById(dashId);
    const layout = row?.layout as {
      id: string;
      overrides: {
        filters: { field: string; operator: string; value: unknown }[];
      };
    }[];
    const clone = layout.find((it) => it.id === cloneId)!;
    const pin = clone.overrides.filters.find((f) => f.field === "status")!;
    expect(pin.operator).toBe("eq");
    expect(pin.value).toBe("active");
  });
  it("should inherit source item dimensions as defaults when placement omits width/height", async () => {
    const { dashId, sourceItemId } = await makeDashWithVizItem();
    const cloneId = id();

    await commit(
      cmd("FanOutDashboardItems", {
        dashboardId: dashId,
        sourceItemId,
        field: "category",
        placements: [{ id: cloneId, value: "A", x: 7, y: 0 }],
      }),
    );

    const [row] = await dashboardsById(dashId);
    const layout = row?.layout as {
      id: string;
      width: number;
      height: number;
    }[];
    const clone = layout.find((it) => it.id === cloneId)!;
    // Source item was 6×4; clone must inherit those dimensions.
    expect(clone.width).toBe(6);
    expect(clone.height).toBe(4);
  });
  it("should preserve existing overrides on the source item and not mutate it", async () => {
    const existingFilters = [
      { field: "year", operator: "eq" as const, value: 2024 },
    ];
    const { dashId, sourceItemId } = await makeDashWithVizItem({
      existingFilters,
    });
    const cloneId = id();

    await commit(
      cmd("FanOutDashboardItems", {
        dashboardId: dashId,
        sourceItemId,
        field: "region",
        placements: [{ id: cloneId, value: "EMEA", x: 0, y: 8 }],
      }),
    );

    const [row] = await dashboardsById(dashId);
    const layout = row?.layout as {
      id: string;
      overrides?: {
        filters?: { field: string; operator: string; value: unknown }[];
      };
    }[];

    // Source item's overrides are byte-identical (not mutated by fan-out).
    const source = layout.find((it) => it.id === sourceItemId)!;
    expect(source.overrides?.filters).toEqual(existingFilters);

    // Clone carries both the inherited year filter AND the new region pin.
    const clone = layout.find((it) => it.id === cloneId)!;
    const cloneFilters = clone.overrides?.filters ?? [];
    expect(cloneFilters).toContainEqual(existingFilters[0]);
    expect(cloneFilters).toContainEqual({
      field: "region",
      operator: "eq",
      value: "EMEA",
    });
  });
  it("should replace an existing same-field filter on the source rather than duplicating it", async () => {
    const existingFilters = [
      { field: "region", operator: "eq" as const, value: "US" },
    ];
    const { dashId, sourceItemId } = await makeDashWithVizItem({
      existingFilters,
    });
    const cloneId = id();

    await commit(
      cmd("FanOutDashboardItems", {
        dashboardId: dashId,
        sourceItemId,
        field: "region",
        placements: [{ id: cloneId, value: "EMEA", x: 0, y: 8 }],
      }),
    );

    const [row] = await dashboardsById(dashId);
    const layout = row?.layout as {
      id: string;
      overrides?: {
        filters?: { field: string; operator: string; value: unknown }[];
      };
    }[];
    const clone = layout.find((it) => it.id === cloneId)!;
    const regionFilters = (clone.overrides?.filters ?? []).filter(
      (f) => f.field === "region",
    );
    // Exactly one region filter — the old "US" filter was replaced by "EMEA".
    expect(regionFilters).toHaveLength(1);
    expect(regionFilters[0]?.value).toBe("EMEA");
  });
  it("should leave the insight definition byte-identical after fan-out (source insight never mutated)", async () => {
    const { dashId, sourceItemId, insightId } = await makeDashWithVizItem();

    const insightBefore = (await insightsById(insightId))[0];

    await commit(
      cmd("FanOutDashboardItems", {
        dashboardId: dashId,
        sourceItemId,
        field: "country",
        placements: [
          { id: id(), value: "US", x: 0, y: 6 },
          { id: id(), value: "GB", x: 6, y: 6 },
        ],
      }),
    );

    const insightAfter = (await insightsById(insightId))[0];
    // The insight row is structurally identical — fan-out only writes layout.
    expect(JSON.stringify(insightAfter?.definition)).toBe(
      JSON.stringify(insightBefore?.definition),
    );
  });
  it("should use placement-supplied width/height when provided (overrides source dimensions)", async () => {
    const { dashId, sourceItemId } = await makeDashWithVizItem();
    const cloneId = id();

    await commit(
      cmd("FanOutDashboardItems", {
        dashboardId: dashId,
        sourceItemId,
        field: "region",
        placements: [
          { id: cloneId, value: "EMEA", x: 0, y: 8, width: 3, height: 2 },
        ],
      }),
    );

    const [row] = await dashboardsById(dashId);
    const layout = row?.layout as {
      id: string;
      width: number;
      height: number;
    }[];
    const clone = layout.find((it) => it.id === cloneId)!;
    // Explicit placement dims take precedence over source item's 6×4.
    expect(clone.width).toBe(3);
    expect(clone.height).toBe(2);
  });
  it("should reject a source item that is markdown (no visualizationId to clone)", async () => {
    const dashId = id();
    const markdownId = id();
    await commit(
      cmd("CreateDashboard", { id: dashId, name: "D" }),
      cmd("AddDashboardItem", {
        dashboardId: dashId,
        item: {
          id: markdownId,
          type: "markdown",
          content: "## Title",
          x: 0,
          y: 0,
          width: 12,
          height: 2,
        },
      }),
    );

    await expect(
      commit(
        cmd("FanOutDashboardItems", {
          dashboardId: dashId,
          sourceItemId: markdownId,
          field: "region",
          placements: [{ id: id(), value: "EMEA", x: 0, y: 4 }],
        }),
      ),
    ).rejects.toThrow();
  });
  it("should reject a missing sourceItemId (no silent no-op)", async () => {
    const { dashId } = await makeDashWithVizItem();
    await expect(
      commit(
        cmd("FanOutDashboardItems", {
          dashboardId: dashId,
          sourceItemId: id(),
          field: "region",
          placements: [{ id: id(), value: "EMEA", x: 0, y: 4 }],
        }),
      ),
    ).rejects.toThrow();
  });
  it("should reject empty placements (no silent no-op)", async () => {
    const { dashId, sourceItemId } = await makeDashWithVizItem();
    await expect(
      commit(
        cmd("FanOutDashboardItems", {
          dashboardId: dashId,
          sourceItemId,
          field: "region",
          placements: [],
        }),
      ),
    ).rejects.toThrow();
  });
  it("should reject duplicate placement ids (no corrupt layout state)", async () => {
    const { dashId, sourceItemId } = await makeDashWithVizItem();
    const dupId = id();
    await expect(
      commit(
        cmd("FanOutDashboardItems", {
          dashboardId: dashId,
          sourceItemId,
          field: "region",
          placements: [
            { id: dupId, value: "EMEA", x: 0, y: 4 },
            { id: dupId, value: "APAC", x: 6, y: 4 },
          ],
        }),
      ),
    ).rejects.toThrow();
  });
  it("should reject a placement id that already exists in the layout (client-id invariant)", async () => {
    const { dashId, sourceItemId } = await makeDashWithVizItem();
    // Use the source item's own id as a collision.
    await expect(
      commit(
        cmd("FanOutDashboardItems", {
          dashboardId: dashId,
          sourceItemId,
          field: "region",
          placements: [{ id: sourceItemId, value: "EMEA", x: 0, y: 4 }],
        }),
      ),
    ).rejects.toThrow();
  });
  it("should reject a missing dashboard (no silent no-op)", async () => {
    await expect(
      commit(
        cmd("FanOutDashboardItems", {
          dashboardId: id(),
          sourceItemId: id(),
          field: "region",
          placements: [{ id: id(), value: "EMEA", x: 0, y: 4 }],
        }),
      ),
    ).rejects.toThrow();
  });
  it("should reject a placement that omits the value key (null is allowed, absent is not)", async () => {
    const { dashId, sourceItemId } = await makeDashWithVizItem();
    // A placement with value: null is valid (pin IS NULL).
    await expect(
      commit(
        cmd("FanOutDashboardItems", {
          dashboardId: dashId,
          sourceItemId,
          field: "region",
          placements: [{ id: id(), value: null, x: 0, y: 8 }],
        }),
      ),
    ).resolves.toMatchObject({ mode: "commit" });

    // A placement without a value key at all must be rejected (would produce a
    // valueless filter object in JSON — `{"field":"region","operator":"eq"}`).
    await expect(
      commit(
        cmd("FanOutDashboardItems", {
          dashboardId: dashId,
          sourceItemId,
          field: "status",
          placements: [
            { id: id(), x: 0, y: 10 } as unknown as {
              id: string;
              value: unknown;
              x: number;
              y: number;
            },
          ],
        }),
      ),
    ).rejects.toThrow();
  });
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
    await expect(commit(cmd("DeleteNode", { id: id() }))).rejects.toThrow();
  });
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
  it("should surface orphaned Insights when a DataTable they source is deleted (reference boundary)", async () => {
    // The Artifact Model's typed-edge rule: DataTable → Insight is a reference
    // edge. Deleting the DataTable must NOT auto-delete the Insight; instead it
    // must return the Insight in orphanedNodes so the caller can route it to
    // the TBD repair target. The Insight remains in the DB, reachable but broken.
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
    expect(value.orphanedNodes.filter((n) => n.id === insightId)).toHaveLength(
      1,
    );
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
    expect(value.orphanedNodes.filter((n) => n.id === insightId)).toHaveLength(
      1,
    );
  });
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
    ).rejects.toThrow();
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
    ).rejects.toThrow();
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
    ).rejects.toThrow();
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
    ).rejects.toThrow();
  });
});
