import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../convex/_generated/api";
import { validateMetric } from "../convex/engine";
import schema from "../convex/schema";
import { parseStoredDataTableState } from "../convex/tableCodec";
import { AGGREGATIONS } from "@dashframe/types";

const modules = import.meta.glob("../convex/**/*.ts");
const makeTest = () => convexTest(schema, modules);
let t: ReturnType<typeof makeTest>;

beforeEach(() => {
  t = makeTest();
});

it("accepts every public aggregation and rejects values outside the list", () => {
  for (const aggregation of AGGREGATIONS) {
    expect(
      parseStoredDataTableState(state({ aggregation }), "table").metrics[0]
        .aggregation,
    ).toBe(aggregation);
  }
  expect(() =>
    parseStoredDataTableState(
      state({ aggregation: "not-an-aggregation" }),
      "table",
    ),
  ).toThrow(/metrics\.0\.aggregation/);
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
  ).toEqual({ tablesRepaired: 2, insightsRepaired: 0 });
  expect(
    await t.mutation(internal.host.repairGa4MeasureContracts, {
      workspaceId: "workspace",
    }),
  ).toEqual({ tablesRepaired: 0, insightsRepaired: 0 });
  const rows = await t.run((ctx) => ctx.db.query("dataTables").collect());
  const repairedIds = new Set([
    "workspace-googleAnalytics-v1",
    "workspace-googleAnalytics-unversioned",
  ]);
  for (const row of rows.filter((row) => repairedIds.has(row.id))) {
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
  ).toEqual({ tablesRepaired: 1, insightsRepaired: 1 });
  expect(
    await t.mutation(internal.host.repairGa4MeasureContracts, {
      workspaceId: "workspace",
    }),
  ).toEqual({ tablesRepaired: 0, insightsRepaired: 0 });

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
  ).toEqual({ tablesRepaired: 1, insightsRepaired: 0 });
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
  ).toEqual({ tablesRepaired: 1, insightsRepaired: 0 });
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
