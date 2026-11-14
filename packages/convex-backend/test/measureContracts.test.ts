import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../convex/_generated/api";
import { validateMetric } from "../convex/engine";
import schema from "../convex/schema";
import { parseStoredDataTableState } from "../convex/tableCodec";

const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;

beforeEach(() => {
  t = makeTest();
});
afterEach(() => {
  vi.useRealTimers();
});

const state = (overrides: Record<string, unknown> = {}) => ({
  fields: [
    {
      id: "week",
      name: "Week",
      tableId: "table",
      columnName: "yearWeek",
      type: "date",
      scope: "time",
    },
  ],
  metrics: [
    {
      id: "users",
      name: "Active users",
      tableId: "table",
      columnName: "activeUsers",
      aggregation: "sum",
      contract: { kind: "non-additive" },
      ...overrides,
    },
  ],
});

describe("measure aggregation contract validation", () => {
  it("accepts persisted field scopes and measure contracts", () => {
    expect(parseStoredDataTableState(state(), "table")).toMatchObject(state());
    expect(() =>
      validateMetric(
        {
          ...state().metrics[0],
          contract: { kind: "additive", additiveOver: ["time", "session"] },
        },
        false,
      ),
    ).not.toThrow();
  });

  it("rejects malformed persisted contracts and field scopes", () => {
    expect(() =>
      parseStoredDataTableState(
        state({ contract: { kind: "additive", additiveOver: ["account"] } }),
        "table",
      ),
    ).toThrow(
      'table is invalid: metrics.0.contract.additiveOver.0 Invalid option: expected one of "time"|"user"|"session"|"event"|"item"',
    );
    expect(() =>
      parseStoredDataTableState(
        { ...state(), fields: [{ ...state().fields[0], scope: "account" }] },
        "table",
      ),
    ).toThrow(/scope/);
    expect(() =>
      validateMetric(
        { ...state().metrics[0], contract: { kind: "sometimes" } },
        false,
      ),
    ).toThrow();
  });

  it("rejects nested additive scopes that stringify to a valid scope", () => {
    expect(() =>
      validateMetric(
        {
          ...state().metrics[0],
          contract: { kind: "additive", additiveOver: [["time"]] },
        },
        false,
      ),
    ).toThrow("Invalid additive measure scope");
  });

  it("rejects ratio contracts without an expression", () => {
    expect(() =>
      validateMetric(
        { ...state().metrics[0], contract: { kind: "ratio" } },
        false,
      ),
    ).toThrow("Ratio measures require an expression");
    expect(() =>
      validateMetric(
        {
          ...state().metrics[0],
          sourceTable: "table",
          contract: { kind: "ratio" },
          expression: { kind: "constant", value: 1 },
        },
        true,
      ),
    ).not.toThrow();
    expect(() =>
      validateMetric(
        {
          ...state().metrics[0],
          sourceTable: "table",
          contract: { kind: "additive", additiveOver: ["invalid"] },
        },
        true,
      ),
    ).toThrow();
  });
});

it("scopes legacy GA4 dates without changing Count measures or other sources", async () => {
  await t.run(async (ctx) => {
    for (const [workspaceId, kind, version] of [
      ["workspace", "googleAnalytics", "v1"],
      ["workspace", "googleAnalytics", undefined],
      ["workspace", "googleAnalytics", "v3"],
      ["workspace", "csv", "v2"],
      ["other", "googleAnalytics", "v2"],
    ]) {
      const id = `${workspaceId}-${kind}-${version ?? "unversioned"}`;
      await ctx.db.insert("dataSources", {
        workspaceId: workspaceId!,
        id,
        revision: 1,
        name: id,
        createdAt: 1,
        kind,
        config: version === undefined ? {} : { sourceBindingVersion: version },
      });
      await ctx.db.insert("dataTables", {
        workspaceId: workspaceId!,
        id,
        revision: 1,
        name: id,
        createdAt: 1,
        dataSourceId: id,
        table: "properties/1",
        fields: [
          {
            id: "date",
            name: "Date",
            tableId: id,
            columnName: "date",
            type: "date",
          },
        ],
        metrics: [
          {
            id: "users",
            tableId: id,
            name:
              version === "v1" || version === undefined
                ? "Count"
                : "Sum of Active users",
            ...(version === "v1" || version === undefined
              ? {}
              : { columnName: "activeUsers" }),
            aggregation:
              version === "v1" || version === undefined ? "count" : "sum",
          },
        ],
      });
    }
  });
  expect(
    await t.mutation(internal.host.repairGa4MeasureContracts, {
      workspaceId: "workspace",
    }),
  ).toEqual({ tablesRepaired: 2, insightsRepaired: 0, complete: true });
  expect(
    await t.mutation(internal.host.repairGa4MeasureContracts, {
      workspaceId: "workspace",
    }),
  ).toEqual({ tablesRepaired: 0, insightsRepaired: 0, complete: true });
  const rows = await t.run((ctx) => ctx.db.query("dataTables").collect());
  const repairedIds = new Set([
    "workspace-googleAnalytics-v1",
    "workspace-googleAnalytics-unversioned",
  ]);
  const repaired = rows.filter((row) => repairedIds.has(row.id));
  expect(repaired).toHaveLength(2);
  for (const row of repaired) {
    expect(row.revision).toBe(2);
    expect(row.fields?.[0]?.scope).toBe("time");
    expect(row.metrics?.[0]).toMatchObject({
      name: "Count",
      aggregation: "count",
    });
    expect(row.metrics?.[0]).not.toHaveProperty("columnName");
    expect(row.metrics?.[0]).not.toHaveProperty("contract");
  }
  expect(
    rows
      .filter((row) => !repairedIds.has(row.id))
      .every(
        (row) =>
          row.revision === 1 &&
          row.fields?.[0]?.scope === undefined &&
          row.metrics?.[0]?.contract === undefined &&
          row.metrics?.[0]?.name === "Sum of Active users",
      ),
  ).toBe(true);
});

it("repairs legacy v2 GA4 contracts and field scopes exactly once", async () => {
  await t.run(async (ctx) => {
    await ctx.db.insert("dataSources", {
      workspaceId: "workspace",
      id: "source",
      revision: 1,
      name: "Analytics",
      createdAt: 1,
      kind: "googleAnalytics",
      storage: "live",
      config: { sourceBindingVersion: "v2" },
    });
    await ctx.db.insert("dataTables", {
      workspaceId: "workspace",
      id: "table",
      revision: 1,
      name: "Acquisition",
      createdAt: 1,
      dataSourceId: "source",
      table: "properties/1",
      fields: [
        {
          id: "date",
          name: "Date",
          tableId: "table",
          columnName: "date",
          type: "date",
        },
        {
          id: "week",
          name: "Week",
          tableId: "table",
          columnName: "yearWeek",
          type: "date",
          // Deliberately not the connector default ("time"): the repair must
          // keep a scope that is already set, whatever it is.
          scope: "session",
        },
        {
          id: "channel",
          name: "Channel",
          tableId: "table",
          columnName: "sessionDefaultChannelGroup",
          type: "string",
        },
        {
          id: "revenue",
          name: "Revenue",
          tableId: "table",
          columnName: "totalRevenue",
          type: "number",
        },
      ],
      metrics: [
        {
          id: "users",
          tableId: "table",
          columnName: "activeUsers",
          aggregation: "sum",
          name: "Sum of Active users",
        },
        {
          id: "formula-users",
          tableId: "table",
          columnName: "activeUsers",
          aggregation: "sum",
          name: "Formula audience",
          expression: { kind: "constant", value: 1 },
        },
      ],
    });
    await ctx.db.insert("insights", {
      workspaceId: "workspace",
      id: "insight",
      revision: 1,
      name: "Acquisition report",
      createdAt: 1,
      definition: {
        id: "insight",
        name: "Acquisition report",
        source: { sourceType: "dataTable", sourceId: "table" },
        selectedFields: ["week"],
        metrics: [
          {
            id: "users",
            sourceTable: "table",
            columnName: "activeUsers",
            aggregation: "sum",
            name: "Weekly audience",
          },
          {
            id: "default-users",
            sourceTable: "table",
            columnName: "activeUsers",
            aggregation: "sum",
            name: "Sum of Active users",
          },
          {
            id: "formula-users",
            sourceTable: "table",
            columnName: "activeUsers",
            aggregation: "sum",
            name: "Formula audience",
            expression: { kind: "constant", value: 1 },
          },
        ],
        createdAt: 1,
      },
    });
  });

  expect(
    await t.mutation(internal.host.repairGa4MeasureContracts, {
      workspaceId: "workspace",
    }),
  ).toEqual({ tablesRepaired: 1, insightsRepaired: 1, complete: true });
  expect(
    await t.mutation(internal.host.repairGa4MeasureContracts, {
      workspaceId: "workspace",
    }),
  ).toEqual({ tablesRepaired: 0, insightsRepaired: 0, complete: true });

  const table = await t.run((ctx) =>
    ctx.db
      .query("dataTables")
      .withIndex("by_workspaceId_and_id", (q) =>
        q.eq("workspaceId", "workspace").eq("id", "table"),
      )
      .unique(),
  );
  expect(table?.revision).toBe(2);
  expect(table?.metrics?.[0]).toMatchObject({
    name: "Active users",
    contract: { kind: "non-additive" },
  });
  expect(table?.metrics?.[1]).toMatchObject({ name: "Formula audience" });
  expect(table?.metrics?.[1]).not.toHaveProperty("contract");
  expect(table?.fields?.map((field) => field.scope)).toEqual([
    "time",
    "session",
    "session",
    undefined,
  ]);
  const repairedInsight = await t.run((ctx) =>
    ctx.db
      .query("insights")
      .withIndex("by_workspaceId_and_id", (q) =>
        q.eq("workspaceId", "workspace").eq("id", "insight"),
      )
      .unique(),
  );
  expect(repairedInsight?.revision).toBe(2);
  expect(repairedInsight?.refreshRevision).toBeTruthy();
  const repairedMetrics = repairedInsight?.definition?.metrics;
  expect(
    Array.isArray(repairedMetrics) ? repairedMetrics[0] : undefined,
  ).toMatchObject({
    name: "Weekly audience",
    contract: { kind: "non-additive" },
  });
  expect(
    Array.isArray(repairedMetrics) ? repairedMetrics[1] : undefined,
  ).toMatchObject({
    name: "Active users",
    contract: { kind: "non-additive" },
  });
  expect(
    Array.isArray(repairedMetrics) ? repairedMetrics[2] : undefined,
  ).toMatchObject({
    name: "Formula audience",
  });
  expect(
    Array.isArray(repairedMetrics) ? repairedMetrics[2] : undefined,
  ).not.toHaveProperty("contract");
});

it("skips malformed legacy tables and repairs the remaining GA4 tables", async () => {
  await t.run(async (ctx) => {
    await ctx.db.insert("dataSources", {
      workspaceId: "workspace",
      id: "source",
      revision: 1,
      name: "Analytics",
      createdAt: 1,
      kind: "googleAnalytics",
      config: { sourceBindingVersion: "v2" },
    });
    for (const { id, fields } of [
      { id: "bad", fields: [{ ...state().fields[0], scope: "account" }] },
      { id: "good", fields: state().fields },
    ]) {
      await ctx.db.insert("dataTables", {
        workspaceId: "workspace",
        id,
        revision: 1,
        name: id,
        createdAt: 1,
        dataSourceId: "source",
        table: `properties/${id}`,
        fields,
        metrics: [
          {
            id: `users-${id}`,
            tableId: id,
            columnName: "activeUsers",
            aggregation: "sum",
            name: "Sum of Active users",
          },
        ],
      });
    }
  });
  expect(
    await t.mutation(internal.host.repairGa4MeasureContracts, {
      workspaceId: "workspace",
    }),
  ).toEqual({ tablesRepaired: 1, insightsRepaired: 0, complete: true });
  const good = await t.run((ctx) =>
    ctx.db
      .query("dataTables")
      .withIndex("by_workspaceId_and_id", (q) =>
        q.eq("workspaceId", "workspace").eq("id", "good"),
      )
      .unique(),
  );
  expect(good?.metrics?.[0]?.name).toBe("Active users");
});

it("skips a malformed legacy insight without rolling back table repairs", async () => {
  await t.run(async (ctx) => {
    await ctx.db.insert("dataSources", {
      workspaceId: "workspace",
      id: "source",
      revision: 1,
      name: "Analytics",
      createdAt: 1,
      kind: "googleAnalytics",
      config: { sourceBindingVersion: "v2" },
    });
    await ctx.db.insert("dataTables", {
      workspaceId: "workspace",
      id: "table",
      revision: 1,
      name: "Acquisition",
      createdAt: 1,
      dataSourceId: "source",
      table: "properties/1",
      fields: state().fields,
      metrics: [
        {
          id: "users",
          tableId: "table",
          columnName: "activeUsers",
          aggregation: "sum",
          name: "Sum of Active users",
        },
      ],
    });
    await ctx.db.insert("insights", {
      workspaceId: "workspace",
      id: "bad-insight",
      revision: 1,
      name: "Broken report",
      createdAt: 1,
      definition: {
        id: "bad-insight",
        name: "Broken report",
        source: { sourceType: "dataTable", sourceId: "table" },
        selectedFields: ["week"],
        metrics: [
          {
            id: "",
            sourceTable: "table",
            columnName: "activeUsers",
            aggregation: "sum",
            name: "Sum of Active users",
          },
        ],
        createdAt: 1,
      },
    });
  });

  expect(
    await t.mutation(internal.host.repairGa4MeasureContracts, {
      workspaceId: "workspace",
    }),
  ).toEqual({ tablesRepaired: 1, insightsRepaired: 0, complete: true });
  const rows = await t.run((ctx) => ctx.db.query("dataTables").collect());
  expect(rows[0]?.metrics?.[0]).toMatchObject({
    name: "Active users",
    contract: { kind: "non-additive" },
  });
  const insights = await t.run((ctx) => ctx.db.query("insights").collect());
  expect(insights[0]?.revision).toBe(1);
  const originalMetrics = insights[0]?.definition?.metrics;
  expect(
    Array.isArray(originalMetrics) ? originalMetrics[0] : undefined,
  ).toMatchObject({
    id: "",
    name: "Sum of Active users",
  });
});

it("repairs tables and insights past one batch through scheduled continuation", async () => {
  vi.useFakeTimers();
  const tableIds = Array.from(
    { length: 1001 },
    (_, index) => `table-${String(index).padStart(4, "0")}`,
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("dataSources", {
      workspaceId: "workspace",
      id: "ga4",
      revision: 1,
      name: "GA4",
      createdAt: 1,
      kind: "googleAnalytics",
      config: { sourceBindingVersion: "v2" },
    });
    // Later sources: another legacy GA4 source so the walk crosses sources,
    // a GA4 source whose binding already carries contracts, and a CSV source.
    for (const [id, kind, config] of [
      ["ga4-b", "googleAnalytics", { sourceBindingVersion: "v1" }],
      ["ga4-v3", "googleAnalytics", { sourceBindingVersion: "v3" }],
      ["csv", "csv", {}],
    ] as const)
      await ctx.db.insert("dataSources", {
        workspaceId: "workspace",
        id,
        revision: 1,
        name: id,
        createdAt: 1,
        kind,
        config,
      });
    for (const source of ["ga4-b", "ga4-v3"])
      for (let index = 0; index < 3; index++) {
        const id = `${source}-table-${index}`;
        await ctx.db.insert("dataTables", {
          workspaceId: "workspace",
          id,
          revision: 1,
          name: id,
          createdAt: 1,
          dataSourceId: source,
          table: "properties/2",
          fields: [
            {
              id: "date",
              name: "Date",
              tableId: id,
              columnName: "date",
              type: "date",
            },
          ],
          metrics: [],
        });
      }
    for (const id of tableIds) {
      await ctx.db.insert("dataTables", {
        workspaceId: "workspace",
        id,
        revision: 1,
        name: id,
        createdAt: 1,
        dataSourceId: "ga4",
        table: "properties/1",
        fields: [
          {
            id: "date",
            name: "Date",
            tableId: id,
            columnName: "date",
            type: "date",
          },
        ],
        metrics: [
          {
            id: "users",
            tableId: id,
            name: "Sum of Active users",
            columnName: "activeUsers",
            aggregation: "sum",
          },
        ],
      });
      await ctx.db.insert("insights", {
        workspaceId: "workspace",
        id: `insight-${id}`,
        revision: 1,
        name: id,
        createdAt: 1,
        definition: {
          id: `insight-${id}`,
          name: id,
          source: { sourceType: "dataTable", sourceId: id },
          selectedFields: [],
          metrics: [
            {
              id: "users",
              sourceTable: id,
              columnName: "activeUsers",
              aggregation: "sum",
              name: "Sum of Active users",
            },
          ],
          createdAt: 1,
        },
      });
    }
    await ctx.db.insert("dataTables", {
      workspaceId: "workspace",
      id: "table-csv",
      revision: 1,
      name: "CSV table",
      createdAt: 1,
      dataSourceId: "csv",
      table: "t.csv",
      fields: [
        {
          id: "date",
          name: "Date",
          tableId: "table-csv",
          columnName: "date",
          type: "date",
        },
      ],
      metrics: [],
    });
  });
  const first = await t.mutation(internal.host.repairGa4MeasureContracts, {
    workspaceId: "workspace",
  });
  expect(first.complete).toBe(false);
  expect(first.tablesRepaired).toBeGreaterThan(0);
  expect(first.tablesRepaired).toBeLessThan(1001);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const rows = await t.run(async (ctx) => ({
    tables: await ctx.db.query("dataTables").collect(),
    insights: await ctx.db.query("insights").collect(),
  }));
  const ga4Tables = rows.tables.filter((row) => row.dataSourceId === "ga4");
  expect(ga4Tables).toHaveLength(1001);
  for (const table of ga4Tables) {
    // Each continuation resumes after the id the previous batch stopped at,
    // so no table is patched twice.
    expect(table.revision).toBe(2);
    expect(table.fields?.[0]?.scope).toBe("time");
    expect(table.metrics?.[0]).toMatchObject({
      name: "Active users",
      contract: { kind: "non-additive" },
    });
  }
  for (const row of rows.tables.filter((row) => row.dataSourceId === "ga4-b"))
    expect(row).toMatchObject({ revision: 2, fields: [{ scope: "time" }] });
  for (const row of rows.tables.filter(
    (row) => row.dataSourceId === "ga4-v3" || row.dataSourceId === "csv",
  )) {
    expect(row.revision).toBe(1);
    expect(row.fields?.[0]?.scope).toBeUndefined();
  }
  expect(rows.insights).toHaveLength(1001);
  for (const insight of rows.insights)
    expect(insight.definition?.metrics).toEqual([
      expect.objectContaining({
        name: "Active users",
        contract: { kind: "non-additive" },
      }),
    ]);
  expect(await t.run((ctx) => ctx.db.query("hostSettings").collect())).toEqual(
    [],
  );
  // A later boot walks again: it finds nothing to repair and patches nothing,
  // but it does reach a legacy row that appeared after the first walk.
  await t.run((ctx) =>
    ctx.db.insert("dataTables", {
      workspaceId: "workspace",
      id: "table-late",
      revision: 1,
      name: "Published from a legacy draft",
      createdAt: 2,
      dataSourceId: "ga4",
      table: "properties/1",
      fields: [
        {
          id: "date",
          name: "Date",
          tableId: "table-late",
          columnName: "date",
          type: "date",
        },
      ],
      metrics: [],
    }),
  );
  expect(
    await t.mutation(internal.host.repairGa4MeasureContracts, {
      workspaceId: "workspace",
    }),
  ).toMatchObject({ insightsRepaired: 0, complete: false });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const again = await t.run((ctx) => ctx.db.query("dataTables").collect());
  expect(
    again.every(
      (row) =>
        row.revision ===
        (row.dataSourceId === "ga4" || row.dataSourceId === "ga4-b" ? 2 : 1),
    ),
  ).toBe(true);
  expect(again.find((row) => row.id === "table-late")?.fields?.[0]?.scope).toBe(
    "time",
  );
}, 60_000);

it("retires a queued repair walk when a new call starts one", async () => {
  vi.useFakeTimers();
  await t.run(async (ctx) => {
    await ctx.db.insert("dataSources", {
      workspaceId: "workspace",
      id: "ga4",
      revision: 1,
      name: "GA4",
      createdAt: 1,
      kind: "googleAnalytics",
      config: {},
    });
    for (let index = 0; index < 5; index++) {
      const id = `table-${index}`;
      await ctx.db.insert("dataTables", {
        workspaceId: "workspace",
        id,
        revision: 1,
        name: id,
        createdAt: 1,
        dataSourceId: "ga4",
        table: "properties/1",
        fields: [
          {
            id: "date",
            name: "Date",
            tableId: id,
            columnName: "date",
            type: "date",
          },
        ],
        metrics: [],
      });
    }
  });
  const repair = () =>
    t.mutation(internal.host.repairGa4MeasureContracts, {
      workspaceId: "workspace",
      batchSize: 2,
    });
  // The source read costs one of the two rows, so the first batch repairs one table.
  expect(await repair()).toMatchObject({ tablesRepaired: 1, complete: false });
  // A second boot before the first walk's continuation ran: it starts over
  // and owns the only live walk from here on.
  expect(await repair()).toMatchObject({ tablesRepaired: 0, complete: false });
  expect(
    await t.run((ctx) => ctx.db.query("hostSettings").collect()),
  ).toHaveLength(1);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const tables = await t.run((ctx) => ctx.db.query("dataTables").collect());
  expect(tables.map((row) => row.revision)).toEqual([2, 2, 2, 2, 2]);
  expect(tables.every((row) => row.fields?.[0]?.scope === "time")).toBe(true);
  expect(await t.run((ctx) => ctx.db.query("hostSettings").collect())).toEqual(
    [],
  );
});

it("charges each GA4 source to the batch so a long source list spans batches", async () => {
  vi.useFakeTimers();
  await t.run(async (ctx) => {
    const source = async (id: string, config: Record<string, string>) =>
      ctx.db.insert("dataSources", {
        workspaceId: "workspace",
        id,
        revision: 1,
        name: id,
        createdAt: 1,
        kind: "googleAnalytics",
        config,
      });
    for (let index = 0; index < 6; index++)
      await source(`contracted-${index}`, { sourceBindingVersion: "v3" });
    for (let index = 0; index < 2; index++)
      await source(`empty-${index}`, { sourceBindingVersion: "v2" });
    await source("legacy", { sourceBindingVersion: "v1" });
    for (let index = 0; index < 3; index++) {
      const id = `legacy-table-${index}`;
      await ctx.db.insert("dataTables", {
        workspaceId: "workspace",
        id,
        revision: 1,
        name: id,
        createdAt: 1,
        dataSourceId: "legacy",
        table: "properties/1",
        fields: [
          {
            id: "date",
            name: "Date",
            tableId: id,
            columnName: "date",
            type: "date",
          },
        ],
        metrics: [],
      });
    }
    await ctx.db.insert("insights", {
      workspaceId: "workspace",
      id: "insight",
      revision: 1,
      name: "Audience",
      createdAt: 1,
      definition: {
        id: "insight",
        name: "Audience",
        source: { sourceType: "dataTable", sourceId: "legacy-table-0" },
        selectedFields: [],
        metrics: [
          {
            id: "users",
            sourceTable: "legacy-table-0",
            columnName: "activeUsers",
            aggregation: "sum",
            name: "Sum of Active users",
          },
        ],
        createdAt: 1,
      },
    });
  });
  // Two rows per transaction: the nine sources alone need five batches.
  expect(
    await t.mutation(internal.host.repairGa4MeasureContracts, {
      workspaceId: "workspace",
      batchSize: 2,
    }),
  ).toEqual({ tablesRepaired: 0, insightsRepaired: 0, complete: false });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const rows = await t.run(async (ctx) => ({
    tables: await ctx.db.query("dataTables").collect(),
    insights: await ctx.db.query("insights").collect(),
    runs: await ctx.db.query("hostSettings").collect(),
  }));
  expect(rows.tables.map((row) => row.revision)).toEqual([2, 2, 2]);
  expect(rows.insights[0]?.definition?.metrics).toEqual([
    expect.objectContaining({ contract: { kind: "non-additive" } }),
  ]);
  expect(rows.runs).toEqual([]);
});

it("skips the insights when the workspace has no legacy GA4 source", async () => {
  await t.run(async (ctx) => {
    await ctx.db.insert("dataSources", {
      workspaceId: "workspace",
      id: "csv",
      revision: 1,
      name: "CSV",
      createdAt: 1,
      kind: "csv",
      config: {},
    });
    for (let index = 0; index < 5; index++)
      await ctx.db.insert("insights", {
        workspaceId: "workspace",
        id: `insight-${index}`,
        revision: 1,
        name: `Insight ${index}`,
        createdAt: 1,
        definition: { metrics: [] },
      });
  });
  // Five insights would take three batches of two; none is read.
  expect(
    await t.mutation(internal.host.repairGa4MeasureContracts, {
      workspaceId: "workspace",
      batchSize: 2,
    }),
  ).toEqual({ tablesRepaired: 0, insightsRepaired: 0, complete: true });
});
