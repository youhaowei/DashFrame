import {
  buildInsightSQL,
  saveReusableMeasure,
  importReusableMeasure,
  fieldIdToColumnAlias,
  metricIdToColumnAlias,
} from "@dashframe/engine";
import type { DataTable, Insight, InsightMetric } from "@dashframe/types";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { NativeDuckDBEngine } from "./native-engine";
import { arrowIpcToJsonRows } from "./arrow-data-path";

const table: DataTable = {
  id: "sales",
  name: "Sales",
  dataSourceId: "source",
  table: "sales",
  dataFrameId: "sales",
  fields: [
    {
      id: "date",
      name: "Date",
      columnName: "order_date",
      type: "date",
      tableId: "sales",
    },
    {
      id: "country",
      name: "Country",
      columnName: "country",
      type: "string",
      tableId: "sales",
    },
    {
      id: "revenue",
      name: "Revenue",
      columnName: "revenue",
      type: "number",
      tableId: "sales",
    },
    {
      id: "converted",
      name: "Converted",
      columnName: "converted",
      type: "boolean",
      tableId: "sales",
    },
  ],
  metrics: [],
  createdAt: 0,
};
const orders: InsightMetric = {
  id: "orders",
  name: "Orders",
  sourceTable: "sales",
  aggregation: "count",
  filters: [{ field: "converted", operator: "eq", value: true }],
};
const visits: InsightMetric = {
  id: "visits",
  name: "Visits",
  sourceTable: "sales",
  aggregation: "count",
};
const rate: InsightMetric = {
  id: "rate",
  name: "Conversion rate",
  sourceTable: "sales",
  aggregation: "count",
  expression: {
    kind: "binary",
    operator: "divide",
    left: { kind: "measure", measureId: "orders" },
    right: { kind: "measure", measureId: "visits" },
  },
};
const insight: Insight = {
  id: "report",
  name: "Report",
  source: { sourceType: "dataTable", sourceId: "sales" },
  selectedFields: ["country"],
  metrics: [orders, visits, rate],
  createdAt: 0,
};

const pivotTable: DataTable = {
  id: "pivot_sales",
  name: "Pivot sales",
  dataSourceId: "source",
  table: "pivot_sales",
  dataFrameId: "pivot_sales",
  fields: [
    {
      id: "period",
      name: "Period",
      columnName: "period",
      type: "date",
      tableId: "pivot_sales",
    },
    {
      id: "product",
      name: "Product",
      columnName: "product",
      type: "string",
      tableId: "pivot_sales",
    },
    {
      id: "channel",
      name: "Channel",
      columnName: "channel",
      type: "string",
      tableId: "pivot_sales",
    },
    {
      id: "pivot_revenue",
      name: "Revenue",
      columnName: "revenue",
      type: "number",
      tableId: "pivot_sales",
    },
    {
      id: "pivot_converted",
      name: "Converted",
      columnName: "converted",
      type: "boolean",
      tableId: "pivot_sales",
    },
  ],
  metrics: [],
  createdAt: 0,
};

const pivotRevenue: InsightMetric = {
  id: "pivot_revenue",
  name: "Revenue",
  sourceTable: "pivot_sales",
  columnName: "revenue",
  aggregation: "sum",
};
const pivotOrders: InsightMetric = {
  id: "pivot_orders",
  name: "Orders",
  sourceTable: "pivot_sales",
  aggregation: "count",
  filters: [{ field: "converted", operator: "eq", value: true }],
};
const pivotVisits: InsightMetric = {
  id: "pivot_visits",
  name: "Visits",
  sourceTable: "pivot_sales",
  aggregation: "count",
};
const pivotRate: InsightMetric = {
  id: "pivot_rate",
  name: "Rate",
  sourceTable: "pivot_sales",
  aggregation: "count",
  expression: {
    kind: "binary",
    operator: "divide",
    left: { kind: "measure", measureId: "pivot_orders" },
    right: { kind: "measure", measureId: "pivot_visits" },
  },
};

const pivotInsight: Insight = {
  id: "pivot_report",
  name: "Pivot report",
  source: { sourceType: "dataTable", sourceId: "pivot_sales" },
  selectedFields: ["product", "channel"],
  metrics: [pivotRevenue, pivotOrders, pivotVisits, pivotRate],
  reporting: { pivotFields: ["channel"] },
  createdAt: 0,
};

describe("Report measure correctness in DuckDB", () => {
  let engine: NativeDuckDBEngine | undefined;
  afterEach(async () => {
    await engine?.dispose();
    engine = undefined;
  });
  async function query(definition: Insight, asOf?: Date) {
    if (!engine) {
      engine = new NativeDuckDBEngine();
      await engine.initialize();
      await engine.queryArrow(
        `CREATE TABLE df_sales AS SELECT * FROM (VALUES ('US', 100, true), ('US', 0, false), ('CA', 60, true), ('CA', 30, true), ('CA', 0, false), ('CA', 0, false), ('CA', 0, false)) AS t(country, revenue, converted)`,
      );
      await engine.queryArrow(
        "ALTER TABLE df_sales ADD COLUMN order_date DATE",
      );
      await engine.queryArrow(
        "UPDATE df_sales SET order_date = CASE WHEN country = 'US' THEN DATE '2026-01-31' ELSE DATE '2026-02-01' END",
      );
    }
    return arrowIpcToJsonRows(
      await engine.queryArrow(
        buildInsightSQL(table, new Map(), definition, { mode: "query", asOf })!,
      ),
    );
  }
  async function seedPivotSales() {
    await query(insight);
    await engine!.queryArrow(
      `CREATE TABLE df_pivot_sales AS SELECT * FROM (VALUES
        (DATE '2025-12-01', 'A', 'Web', 50, true),
        (DATE '2025-12-01', 'A', 'Store', 10, false),
        (DATE '2025-12-01', 'B', 'Web', 200, true),
        (DATE '2025-12-01', 'B', 'Store', 20, false),
        (DATE '2026-01-01', 'A', 'Web', 100, true),
        (DATE '2026-01-01', 'A', 'Store', 1, false),
        (DATE '2026-01-01', 'A', 'Store', 0, false),
        (DATE '2026-01-01', 'B', 'Web', 90, true),
        (DATE '2026-01-01', 'B', 'Store', 1000, false)
      ) AS t(period, product, channel, revenue, converted)`,
    );
  }
  async function queryPivot(
    definition: Insight,
    options?: Parameters<typeof buildInsightSQL>[3],
  ) {
    const sql = buildInsightSQL(
      pivotTable,
      new Map(),
      definition,
      options ?? { mode: "query" },
    )!;
    return arrowIpcToJsonRows(await engine!.queryArrow(sql));
  }
  it("applies aggregate filters before choosing Top N countries", async () => {
    const rows = await query({
      ...insight,
      metrics: [
        ...insight.metrics,
        {
          id: "revenue",
          name: "Revenue",
          sourceTable: "sales",
          columnName: "revenue",
          aggregation: "sum",
        },
      ],
      filters: [{ field: "metric_orders", operator: "gt", value: 1 }],
      reporting: {
        totals: true,
        topN: {
          fieldId: "country",
          measureId: "revenue",
          count: 1,
          direction: "desc",
        },
      },
    });
    expect(
      rows
        .filter((row) => Number(row.__report_grouping) === 0)
        .map((row) => row.field_country),
    ).toEqual(["CA"]);
    expect(
      rows.find((row) => Number(row.__report_grouping) === 1)?.metric_revenue,
    ).toBe(90);
  });

  it("ranks countries using only monthly groups that pass aggregate filters", async () => {
    await query(insight);
    await engine!.queryArrow(
      "INSERT INTO df_sales VALUES ('US', 200, true, DATE '2026-02-05'), ('US', 0, true, DATE '2026-02-06'), ('CA', 1000, true, DATE '2026-01-05')",
    );
    const rows = await query({
      ...insight,
      selectedFields: ["date", "country"],
      metrics: [
        ...insight.metrics,
        {
          id: "revenue",
          name: "Revenue",
          sourceTable: "sales",
          columnName: "revenue",
          aggregation: "sum",
        },
      ],
      filters: [{ field: "metric_orders", operator: "gt", value: 1 }],
      reporting: {
        dateGrains: { date: "month" },
        totals: true,
        topN: {
          fieldId: "country",
          measureId: "revenue",
          count: 1,
          direction: "desc",
        },
      },
    });
    expect(
      rows
        .filter((row) => Number(row.__report_grouping) === 0)
        .map((row) => row.field_country),
    ).toEqual(["US"]);
    expect(
      rows.find((row) => Number(row.__report_grouping) === 3)?.metric_revenue,
    ).toBe(200);
  });

  it.each([false, true])(
    "retains a hidden revenue sort and limit when displaying orders (totals=%s)",
    async (totals) => {
      await query(insight);
      const definition: Insight = {
        ...insight,
        metrics: [
          ...insight.metrics,
          {
            id: "revenue",
            name: "Revenue",
            sourceTable: "sales",
            columnName: "revenue",
            aggregation: "sum",
          },
        ],
        reporting: { measureIds: ["orders"], totals },
        sorts: [{ field: "metric_revenue", direction: "asc" }],
      };
      const rows = arrowIpcToJsonRows(
        await engine!.queryArrow(
          buildInsightSQL(table, new Map(), definition, {
            mode: "query",
            effectiveSorts: definition.sorts,
            effectiveLimit: 1,
          })!,
        ),
      );
      expect(rows[0]!.field_country).toBe("CA");
      expect(Number(rows[0]!.metric_orders)).toBe(2);
      expect(rows.every((row) => !("metric_revenue" in row))).toBe(true);
      if (totals) expect(Number(rows.at(-1)!.metric_orders)).toBe(2);
    },
  );

  it("sorts complete pivot rows by one cell, then retains every cell and a weighted total", async () => {
    await seedPivotSales();
    const current: Insight = {
      ...pivotInsight,
      reporting: {
        ...pivotInsight.reporting,
        measureIds: ["pivot_rate"],
        totals: true,
        dateRange: {
          fieldId: "period",
          range: {
            type: "absolute",
            start: "2026-01-01T00:00:00Z",
            end: "2026-02-01T00:00:00Z",
          },
        },
      },
    };
    const generic = await queryPivot(
      { ...current, reporting: { ...current.reporting, totals: false } },
      {
        mode: "query",
        effectiveSorts: [
          { field: metricIdToColumnAlias("pivot_revenue"), direction: "desc" },
        ],
      },
    );
    expect(generic[0]).toMatchObject({
      field_product: "B",
      field_channel: "Store",
    });

    const pivotSort = {
      field: metricIdToColumnAlias("pivot_revenue"),
      direction: "desc" as const,
      pivotValues: [{ fieldId: "channel", value: "Web" }],
    };
    const rows = await queryPivot(current, {
      mode: "query",
      effectiveSorts: [pivotSort],
      effectiveLimit: 1,
    });
    const detail = rows.filter((row) => Number(row.__report_grouping) === 0);
    expect(detail.map((row) => row.field_product)).toEqual(["A", "A"]);
    expect(detail.map((row) => row.field_channel).sort()).toEqual([
      "Store",
      "Web",
    ]);
    expect(rows.every((row) => !("metric_pivot_revenue" in row))).toBe(true);
    const grand = rows.find((row) => Number(row.__report_grouping) === 3)!;
    expect(grand.metric_pivot_rate).toBeCloseTo(1 / 3);
  });

  it("puts missing pivot cells last and resolves ties by row dimensions", async () => {
    await seedPivotSales();
    await engine!.queryArrow(
      `INSERT INTO df_pivot_sales VALUES
        (DATE '2026-01-01', 'C', 'Store', 500, false),
        (DATE '2026-01-01', 'D', 'Web', 100, true)`,
    );
    const rows = await queryPivot(
      {
        ...pivotInsight,
        reporting: {
          ...pivotInsight.reporting,
          dateRange: {
            fieldId: "period",
            range: {
              type: "absolute",
              start: "2026-01-01T00:00:00Z",
              end: "2026-02-01T00:00:00Z",
            },
          },
        },
      },
      {
        mode: "query",
        effectiveSorts: [
          {
            field: metricIdToColumnAlias("pivot_revenue"),
            direction: "desc",
            pivotValues: [{ fieldId: "channel", value: "Web" }],
          },
        ],
      },
    );
    expect([...new Set(rows.map((row) => row.field_product))]).toEqual([
      "A",
      "D",
      "B",
      "C",
    ]);
  });

  it("matches ISO date pivot values against grouped DuckDB timestamps", async () => {
    await seedPivotSales();
    const rows = await queryPivot(
      {
        ...pivotInsight,
        selectedFields: ["product", "period"],
        reporting: {
          pivotFields: ["period"],
          dateGrains: { period: "month" },
        },
      },
      {
        mode: "query",
        effectiveLimit: 1,
        effectiveSorts: [
          {
            field: metricIdToColumnAlias("pivot_revenue"),
            direction: "desc",
            pivotValues: [
              { fieldId: "period", value: "2026-01-01T00:00:00.000Z" },
            ],
          },
        ],
      },
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.field_product === "B")).toBe(true);
    const numericTimestamp = await queryPivot(
      {
        ...pivotInsight,
        selectedFields: ["product", "period"],
        reporting: {
          pivotFields: ["period"],
          dateGrains: { period: "month" },
        },
      },
      {
        mode: "query",
        effectiveLimit: 1,
        effectiveSorts: [
          {
            field: metricIdToColumnAlias("pivot_revenue"),
            direction: "desc",
            pivotValues: [
              { fieldId: "period", value: Date.parse("2026-01-01T00:00:00Z") },
            ],
          },
        ],
      },
    );
    expect(numericTimestamp.map((row) => row.field_product)).toEqual([
      "B",
      "B",
    ]);
  });

  it("preserves pivot row order and selected-cohort totals in period comparisons", async () => {
    await seedPivotSales();
    const rows = await queryPivot(
      {
        ...pivotInsight,
        reporting: {
          ...pivotInsight.reporting,
          comparison: "previous_period",
          totals: true,
          dateRange: {
            fieldId: "period",
            range: {
              type: "absolute",
              start: "2026-01-01T00:00:00Z",
              end: "2026-02-01T00:00:00Z",
            },
          },
        },
      },
      {
        mode: "query",
        effectiveLimit: 1,
        effectiveSorts: [
          {
            field: metricIdToColumnAlias("pivot_revenue"),
            direction: "desc",
            pivotValues: [{ fieldId: "channel", value: "Web" }],
          },
        ],
      },
    );
    const detail = rows.filter((row) => Number(row.__report_grouping) === 0);
    expect(detail.map((row) => row.field_product)).toEqual(["A", "A"]);
    const grand = rows.find((row) => Number(row.__report_grouping) === 3)!;
    expect(grand.metric_pivot_revenue).toBe(101);
    expect(grand.metric_pivot_revenue_previous).toBe(60);
    expect(grand.metric_pivot_rate).toBeCloseTo(1 / 3);
    expect(grand.metric_pivot_rate_previous).toBe(0.5);
  });

  it("rejects incomplete, mistyped, and unavailable pivot sort tuples", () => {
    const buildPivot = (sort: NonNullable<Insight["sorts"]>[number]) =>
      buildInsightSQL(pivotTable, new Map(), pivotInsight, {
        mode: "query",
        effectiveSorts: [sort],
      });
    expect(() =>
      buildPivot({
        field: metricIdToColumnAlias("pivot_revenue"),
        direction: "desc",
        pivotValues: [],
      }),
    ).toThrow("each pivot dimension exactly once");
    expect(() =>
      buildPivot({
        field: metricIdToColumnAlias("pivot_revenue"),
        direction: "desc",
        pivotValues: [{ fieldId: "missing", value: "Web" }],
      }),
    ).toThrow("each pivot dimension exactly once");
    expect(() =>
      buildPivot({
        field: "metric_missing",
        direction: "desc",
        pivotValues: [{ fieldId: "channel", value: "Web" }],
      }),
    ).toThrow("unavailable or ambiguous measure");
    expect(() =>
      buildPivot({
        field: metricIdToColumnAlias("pivot_revenue"),
        direction: "desc",
        pivotValues: [{ fieldId: "channel", value: 42 }],
      }),
    ).toThrow("does not match string dimension");
  });

  it("does not let hidden sorting bypass an empty measure selection", () => {
    expect(() =>
      buildInsightSQL(
        table,
        new Map(),
        { ...insight, reporting: { measureIds: [] } },
        {
          mode: "query",
          effectiveSorts: [{ field: "metric_orders", direction: "asc" }],
          effectiveLimit: 1,
        },
      ),
    ).toThrow("Select at least one measure");
  });

  it("rejects a removed sort dimension rather than silently limiting unordered groups", () => {
    expect(() =>
      buildInsightSQL(
        table,
        new Map(),
        { ...insight, selectedFields: ["date"] },
        {
          mode: "query",
          effectiveSorts: [{ field: "field_country", direction: "asc" }],
          effectiveLimit: 1,
        },
      ),
    ).toThrow("Sort dimension is not selected");
  });

  it("executes a reused filtered conversion measure with the same weighted total", async () => {
    const library = saveReusableMeasure(insight.metrics, "rate", "sales");
    const imported = importReusableMeasure(
      library,
      library.at(-1)!.id,
      "sales",
    );
    const importedRate = imported.at(-1)!;
    const result = await query({
      ...insight,
      metrics: imported,
      reporting: { measureIds: [importedRate.id], totals: true },
    });
    const column = metricIdToColumnAlias(importedRate.id);
    const total = result.find((row) => Number(row.__report_grouping) === 1)!;
    expect(total[column]).toBeCloseTo(3 / 7);
    const us = result.find((row) => row.field_country === "US")!;
    expect(us[column]).toBe(0.5);
    expect(
      Object.keys(total).filter((key) => key.startsWith("metric_")),
    ).toEqual([column]);
  });
  it("compares the same current Top N cohort and recomputes baseline ratios and totals", async () => {
    await query(insight);
    await engine!.queryArrow(
      "INSERT INTO df_sales VALUES ('US', 40, true, DATE '2026-02-05'), ('US', 20, true, DATE '2026-02-06'), ('CA', 500, true, DATE '2026-01-05')",
    );
    const definition: Insight = {
      ...insight,
      filters: [
        { field: metricIdToColumnAlias("orders"), operator: "gt", value: 1 },
      ],
      metrics: [
        ...insight.metrics,
        {
          id: "revenue",
          name: "Revenue",
          sourceTable: "sales",
          columnName: "revenue",
          aggregation: "sum",
        },
      ],
      reporting: {
        totals: true,
        comparison: "previous_period",
        dateRange: {
          fieldId: "date",
          range: {
            type: "absolute",
            start: "2026-02-01T00:00:00Z",
            end: "2026-03-01T00:00:00Z",
          },
        },
        topN: {
          fieldId: "country",
          measureId: "revenue",
          count: 1,
          direction: "asc",
        },
      },
    };
    const rows = await query(definition);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row[metricIdToColumnAlias("revenue")]).toBe(60);
      expect(row[`${metricIdToColumnAlias("revenue")}_previous`]).toBe(100);
      expect(row[`${metricIdToColumnAlias("revenue")}_change`]).toBe(-40);
      expect(row[`${metricIdToColumnAlias("revenue")}_change_percent`]).toBe(
        -40,
      );
      expect(row[`${metricIdToColumnAlias("rate")}_previous`]).toBe(0.5);
      expect(row[`${metricIdToColumnAlias("rate")}_change`]).toBe(0.5);
    }
  });

  it("computes KPI comparisons without dimensions and leaves zero-baseline percentage changes undefined", async () => {
    await query(insight);
    await engine!.queryArrow(
      "UPDATE df_sales SET converted = false WHERE order_date < DATE '2026-02-01'",
    );
    const rows = await query({
      ...insight,
      selectedFields: [],
      reporting: {
        comparison: "previous_period",
        dateRange: {
          fieldId: "date",
          range: {
            type: "absolute",
            start: "2026-02-01T00:00:00Z",
            end: "2026-03-01T00:00:00Z",
          },
        },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[`${metricIdToColumnAlias("orders")}_previous`]).toBe(0);
    expect(rows[0]?.[`${metricIdToColumnAlias("orders")}_change`]).toBe(2);
    expect(
      rows[0]?.[`${metricIdToColumnAlias("orders")}_change_percent`],
    ).toBeNull();
    expect(rows[0]?.[`${metricIdToColumnAlias("rate")}_change`]).toBe(0.4);
  });

  it("aligns a leap-day comparison with the clamped previous-year day", async () => {
    await query(insight);
    await engine!.queryArrow(
      "INSERT INTO df_sales VALUES ('US', 10, true, DATE '2024-02-29'), ('US', 5, false, DATE '2023-02-28')",
    );
    const rows = await query({
      ...insight,
      selectedFields: ["date"],
      reporting: {
        comparison: "previous_year",
        dateGrains: { date: "day" },
        dateRange: {
          fieldId: "date",
          range: {
            type: "absolute",
            start: "2024-02-29T00:00:00Z",
            end: "2024-03-01T00:00:00Z",
          },
        },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[`${metricIdToColumnAlias("rate")}_previous`]).toBe(0);
    expect(rows[0]?.[`${metricIdToColumnAlias("rate")}_change`]).toBe(1);
  });

  it("aligns previous-year dates before weekly aggregation", async () => {
    await query(insight);
    await engine!.queryArrow(
      "INSERT INTO df_sales VALUES ('US', 10, true, DATE '2026-02-28'), ('US', 5, false, DATE '2026-03-02'), ('US', 10, true, DATE '2025-02-28'), ('US', 5, false, DATE '2025-03-02')",
    );
    const rows = await query({
      ...insight,
      selectedFields: ["date"],
      reporting: {
        comparison: "previous_year",
        dateGrains: { date: "week" },
        dateRange: {
          fieldId: "date",
          range: {
            type: "absolute",
            start: "2026-02-23T00:00:00Z",
            end: "2026-03-09T00:00:00Z",
          },
        },
      },
    });
    expect(rows).toHaveLength(2);
    expect(
      rows
        .map((row) => row[`${metricIdToColumnAlias("rate")}_previous`])
        .sort(),
    ).toEqual([0, 1]);
    for (const row of rows)
      expect(row[`${metricIdToColumnAlias("rate")}_change`]).toBe(0);
  });

  it("aligns monthly comparison buckets and keeps missing baselines null", async () => {
    const rows = await query({
      ...insight,
      selectedFields: ["date"],
      reporting: {
        dateGrains: { date: "month" },
        totals: true,
        comparison: "previous_period",
        dateRange: {
          fieldId: "date",
          range: {
            type: "absolute",
            start: "2026-02-01T00:00:00Z",
            end: "2026-03-01T00:00:00Z",
          },
        },
      },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row[metricIdToColumnAlias("rate")]).toBe(0.4);
      expect(row[`${metricIdToColumnAlias("rate")}_previous`]).toBe(0.5);
    }
    const missing = await query({
      ...insight,
      reporting: {
        comparison: "previous_year",
        dateRange: {
          fieldId: "date",
          range: {
            type: "absolute",
            start: "2026-02-01T00:00:00Z",
            end: "2026-03-01T00:00:00Z",
          },
        },
      },
    });
    expect(
      missing[0]?.[`${metricIdToColumnAlias("rate")}_previous`],
    ).toBeNull();
  });

  it("projects a selected calculated measure while retaining its hidden dependencies for detail and totals", async () => {
    const rows = await query({
      ...insight,
      reporting: { totals: true, measureIds: ["rate"] },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).not.toHaveProperty(metricIdToColumnAlias("orders"));
      expect(row).not.toHaveProperty(metricIdToColumnAlias("visits"));
    }
    const total = rows.find((row) => Number(row.__report_grouping) === 1);
    expect(total?.[metricIdToColumnAlias("rate")]).toBeCloseTo(3 / 7);
  });

  it("resolves saved relative periods before aggregation and totals at a fixed execution clock", async () => {
    const saved: Insight = JSON.parse(
      JSON.stringify({
        ...insight,
        reporting: {
          totals: true,
          dateRange: { fieldId: "date", range: { type: "previous_month" } },
        },
      }),
    );
    const january = await query(saved, new Date("2026-02-15T12:00:00Z"));
    expect(january).toHaveLength(2);
    expect(
      january.every((row) => row[metricIdToColumnAlias("rate")] === 0.5),
    ).toBe(true);
    const february = await query(saved, new Date("2026-03-15T12:00:00Z"));
    expect(february).toHaveLength(2);
    expect(
      february.every((row) => row[metricIdToColumnAlias("rate")] === 0.4),
    ).toBe(true);
    expect(saved.reporting?.dateRange?.range.type).toBe("previous_month");
  });

  it("uses half-open absolute periods and rejects a non-date field", async () => {
    const rows = await query({
      ...insight,
      reporting: {
        dateRange: {
          fieldId: "date",
          range: {
            type: "absolute",
            start: "2026-01-31T00:00:00Z",
            end: "2026-02-01T00:00:00Z",
          },
        },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[fieldIdToColumnAlias("country")]).toBe("US");
    await expect(
      query({
        ...insight,
        reporting: {
          dateRange: {
            fieldId: "country",
            range: { type: "this_month" },
          },
        },
      }),
    ).rejects.toThrow("unavailable date field");
  });

  it("uses the same filtered aggregates for grouped rows, HAVING, and grand totals after a JSON round trip", async () => {
    const saved: Insight = JSON.parse(JSON.stringify(insight));
    const groups = await query(saved);
    expect(groups).toHaveLength(2);
    expect(
      groups.map((row) => row[metricIdToColumnAlias("rate")]).sort(),
    ).toEqual([0.4, 0.5]);
    const total = await query({ ...saved, selectedFields: [] });
    expect(total[0]?.[metricIdToColumnAlias("orders")]).toBe(3);
    expect(total[0]?.[metricIdToColumnAlias("rate")]).toBeCloseTo(3 / 7);
    const filtered = await query({
      ...saved,
      filters: [
        { field: metricIdToColumnAlias("orders"), operator: "gt", value: 1 },
      ],
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.[fieldIdToColumnAlias("country")]).toBe("CA");
  });
  it("recomputes totals over groups retained by aggregate filtering and limits", async () => {
    const rows = await query({
      ...insight,
      filters: [
        { field: metricIdToColumnAlias("orders"), operator: "gt", value: 1 },
      ],
      reporting: { totals: true, limit: 1 },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.[fieldIdToColumnAlias("country")]).toBe("CA");
    const total = rows.find((row) => row.__report_grouping === 1);
    expect(total?.[metricIdToColumnAlias("orders")]).toBe(2);
    expect(total?.[metricIdToColumnAlias("rate")]).toBeCloseTo(0.4);
  });
  it("groups calendar months and recomputes both pivot margins from source rows", async () => {
    const rows = await query({
      ...insight,
      selectedFields: ["date", "country"],
      reporting: {
        dateGrains: { date: "month" },
        pivotFields: ["country"],
        totals: true,
      },
    });
    expect(rows).toHaveLength(7);
    expect(
      rows
        .filter((row) => row.__report_grouping === 0)
        .map((row) =>
          new Date(row.field_date as number).toISOString().slice(0, 10),
        )
        .sort(),
    ).toEqual(["2026-01-01", "2026-02-01"]);
    expect(rows.filter((row) => row.__report_grouping === 1)).toHaveLength(2);
    expect(rows.filter((row) => row.__report_grouping === 2)).toHaveLength(2);
    expect(
      rows.find((row) => row.__report_grouping === 3)?.metric_rate,
    ).toBeCloseTo(3 / 7);
  });
  it("ranks countries by revenue before splitting months and computes retained totals", async () => {
    const revenue: InsightMetric = {
      id: "revenue",
      name: "Revenue",
      sourceTable: "sales",
      columnName: "revenue",
      aggregation: "sum",
    };
    const rows = await query({
      ...insight,
      selectedFields: ["date", "country"],
      metrics: [...insight.metrics, revenue],
      reporting: {
        dateGrains: { date: "month" },
        totals: true,
        topN: {
          fieldId: "country",
          measureId: "revenue",
          count: 1,
          direction: "desc",
        },
      },
    });
    expect(rows.filter((row) => row.__report_grouping === 0)).toHaveLength(1);
    expect(rows[0]?.field_country).toBe("US");
    expect(
      rows.find((row) => row.__report_grouping === 3)?.metric_revenue,
    ).toBe(100);
    expect(rows.find((row) => row.__report_grouping === 3)?.metric_rate).toBe(
      0.5,
    );
  });
  it("returns null when no rows qualify for a ratio denominator", async () => {
    const rows = await query({
      ...insight,
      selectedFields: [],
      filters: [{ field: "country", operator: "eq", value: "missing" }],
    });
    expect(rows[0]?.[metricIdToColumnAlias("rate")]).toBeNull();
  });
  it("rejects cyclic and missing measure references before executing SQL", () => {
    const cyclic = {
      ...rate,
      expression: { kind: "measure" as const, measureId: "rate" },
    };
    expect(() =>
      buildInsightSQL(
        table,
        new Map(),
        { ...insight, metrics: [cyclic] },
        { mode: "query" },
      ),
    ).toThrow("Cyclic");
    expect(() =>
      buildInsightSQL(
        table,
        new Map(),
        { ...insight, metrics: [rate] },
        { mode: "query" },
      ),
    ).toThrow("Unknown measure");
  });
});
