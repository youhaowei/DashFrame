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
