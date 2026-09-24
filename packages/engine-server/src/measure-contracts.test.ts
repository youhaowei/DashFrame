import { afterEach, expect, it } from "vite-plus/test";
import { buildInsightSQL } from "@dashframe/engine";
import type { DataTable, Insight, InsightMetric } from "@dashframe/types";
import { NativeDuckDBEngine } from "./native-engine";
import { arrowIpcToJsonRows } from "./arrow-data-path";

const metrics: InsightMetric[] = [
  {
    id: "users",
    name: "Active users",
    sourceTable: "ga4",
    columnName: "users",
    aggregation: "sum",
    contract: { kind: "non-additive" },
  },
  {
    id: "sessions",
    name: "Sessions",
    sourceTable: "ga4",
    columnName: "sessions",
    aggregation: "sum",
    contract: { kind: "additive", additiveOver: ["time", "session"] },
  },
  {
    id: "engaged",
    name: "Engaged sessions",
    sourceTable: "ga4",
    columnName: "engaged",
    aggregation: "sum",
    contract: { kind: "additive", additiveOver: ["time", "session"] },
  },
  {
    id: "rate",
    name: "Engagement rate",
    sourceTable: "ga4",
    aggregation: "sum",
    contract: { kind: "ratio" },
    expression: {
      kind: "binary",
      operator: "divide",
      left: { kind: "measure", measureId: "engaged" },
      right: { kind: "measure", measureId: "sessions" },
    },
  },
];
const table: DataTable = {
  id: "ga4",
  name: "Acquisition",
  dataSourceId: "source",
  table: "acquisition",
  dataFrameId: "ga4",
  createdAt: 0,
  fields: [
    {
      id: "week",
      name: "Week",
      tableId: "ga4",
      columnName: "week",
      type: "date",
      scope: "time",
    },
    {
      id: "channel",
      name: "Channel",
      tableId: "ga4",
      columnName: "channel",
      type: "string",
      scope: "session",
    },
    ...["users", "sessions", "engaged"].map((name) => ({
      id: name,
      name,
      tableId: "ga4",
      columnName: name,
      type: "number" as const,
    })),
  ],
  metrics: metrics.map(({ sourceTable, ...metric }) => ({
    ...metric,
    tableId: sourceTable,
  })),
};
const insight: Insight = {
  id: "report",
  name: "Acquisition",
  source: { sourceType: "dataTable", sourceId: "ga4" },
  selectedFields: ["week", "channel"],
  metrics,
  createdAt: 0,
};
let engine: NativeDuckDBEngine | undefined;
afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});
async function query(
  definition: Insight,
  source = table,
  presentation?: { dimensions: string[] },
) {
  if (!engine) {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    await engine.queryArrow(
      "CREATE TABLE df_ga4 AS SELECT * FROM (VALUES (DATE '2026-09-01', 'Search', 8, 10, 9), (DATE '2026-09-01', 'Direct', 4, 30, 3), (DATE '2026-09-08', 'Search', 6, 20, 10), (DATE '2026-09-08', 'Direct', 5, 40, 20)) t(week, channel, users, sessions, engaged)",
    );
  }
  return arrowIpcToJsonRows(
    await engine.queryArrow(
      buildInsightSQL(source, new Map(), definition, {
        mode: "query",
        presentation,
      })!,
    ),
  );
}

it("preserves fetched cells and suppresses user rollups in body, totals, HAVING, and chart presentations", async () => {
  const exact = await query({ ...insight, reporting: { totals: true } });
  expect(
    exact
      .filter((row) => row.__report_grouping === 0)
      .map((row) => row.metric_users)
      .sort(),
  ).toEqual([4, 5, 6, 8]);
  expect(exact.find((row) => row.__report_grouping === 3)).toMatchObject({
    metric_users: null,
    metric_sessions: 100,
    metric_rate: 0.42,
  });
  for (const dimensions of [["week"], ["channel"]]) {
    const rows = await query({ ...insight, selectedFields: dimensions });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.metric_users === null)).toBe(true);
  }
  const weeks = await query({ ...insight, selectedFields: ["week"] });
  expect(weeks.map((row) => row.metric_rate).sort()).toEqual([0.3, 0.5]);
  expect(
    await query({
      ...insight,
      selectedFields: ["week"],
      filters: [{ field: "metric_users", operator: "gt", value: 0 }],
    }),
  ).toEqual([]);
  const chart = await query(insight, table, { dimensions: ["week"] });
  expect(chart.every((row) => row.metric_users === null)).toBe(true);
  expect(chart.map((row) => row.metric_sessions).sort()).toEqual([40, 60]);
});

it("guards disallowed scoped dimensions and ignores unscoped value fields", async () => {
  const restricted: Insight = {
    ...insight,
    metrics: [
      {
        ...metrics[1]!,
        contract: { kind: "additive", additiveOver: ["time"] },
      },
    ],
    reporting: { totals: true },
  };
  const rows = await query(restricted);
  expect(
    rows
      .filter((row) => row.__report_grouping === 0)
      .every((row) => row.metric_sessions !== null),
  ).toBe(true);
  expect(
    rows.find((row) => row.__report_grouping === 3)?.metric_sessions,
  ).toBeNull();
  expect(
    (await query({ ...restricted, selectedFields: ["week"] })).every(
      (row) => row.metric_sessions === null,
    ),
  ).toBe(true);
  const unscoped = {
    ...table,
    fields: table.fields.map((field) =>
      field.id === "channel" ? { ...field, scope: undefined } : field,
    ),
  };
  expect(
    (await query({ ...insight, selectedFields: ["week"] }, unscoped)).every(
      (row) => row.metric_sessions !== null,
    ),
  ).toBe(true);
  const noTime = {
    ...insight,
    selectedFields: ["channel"],
    metrics: [
      {
        ...metrics[1]!,
        contract: {
          kind: "additive" as const,
          additiveOver: ["session" as const],
        },
      },
    ],
  };
  expect(
    (await query(noTime)).every((row) => row.metric_sessions === null),
  ).toBe(true);
});

it("counts only measure-filtered rows when guarding a rollup", async () => {
  const searchUsers: InsightMetric = {
    ...metrics[0]!,
    id: "search_users",
    name: "Search active users",
    filters: [{ field: "channel", operator: "eq", value: "Search" }],
  };
  const rows = await query({
    ...insight,
    selectedFields: ["week"],
    metrics: [searchUsers],
  });
  expect(rows.map((row) => row.metric_search_users).sort()).toEqual([6, 8]);
});
