import { describe, expect, it } from "bun:test";
import type { Insight } from "@dashframe/types";
import {
  buildReportGrid,
  formatMeasureValue,
  formatReportValue,
} from "./report-grid";
const insight: Insight = {
  id: "i",
  name: "Report",
  source: { sourceType: "dataTable", sourceId: "t" },
  selectedFields: ["month", "channel"],
  metrics: [
    {
      id: "rate",
      name: "Conversion",
      aggregation: "count",
      sourceTable: "t",
      format: { style: "percent", decimals: 1 },
    },
  ],
  reporting: { pivotFields: ["channel"], totals: true },
  createdAt: 0,
};
describe("canonical report presentation", () => {
  it("keeps null dimension members distinct from subtotal cells and never recomputes ratios", () => {
    const grid = buildReportGrid(
      [
        {
          field_month: "January",
          field_channel: null,
          metric_rate: 0.5,
          __report_grouping: 0,
        },
        {
          field_month: "January",
          field_channel: "Paid",
          metric_rate: 0.2,
          __report_grouping: 0,
        },
        {
          field_month: "January",
          field_channel: null,
          metric_rate: 0.25,
          __report_grouping: 1,
        },
        {
          field_month: null,
          field_channel: null,
          metric_rate: 0.25,
          __report_grouping: 3,
        },
      ],
      insight,
    );
    expect(grid.columns).toHaveLength(3);
    expect(grid.rows).toHaveLength(2);
    const totalColumn = grid.columns.find((column) => column.total)!;
    expect(grid.rows[0]!.cells[totalColumn.key]).toBe(0.25);
    expect(grid.rows[1]!.total).toBe(true);
  });
  it("carries canonical comparison values into every pivot cell and distinguishes rate points from relative change", () => {
    const grid = buildReportGrid(
      [
        {
          field_month: "January",
          field_channel: "Paid",
          metric_rate: 0.25,
          metric_rate_previous: 0.2,
          metric_rate_change: 0.05,
          metric_rate_change_percent: 25,
        },
      ],
      {
        ...insight,
        reporting: { ...insight.reporting, comparison: "previous_period" },
      },
    );
    expect(grid.columns).toHaveLength(4);
    expect(
      grid.columns.map((column) =>
        formatReportValue(grid.rows[0]!.cells[column.key], column),
      ),
    ).toEqual(["25.0%", "20.0%", "5.0 pp", "25.0%"]);
    expect(formatReportValue(null, grid.columns[3]!)).toBe("—");
  });

  it("formats the same measure for pivot, table and KPI and preserves missing values", () => {
    expect(formatMeasureValue(0.125, { style: "percent", decimals: 1 })).toBe(
      "12.5%",
    );
    expect(
      formatMeasureValue(1234.5, {
        style: "currency",
        currency: "EUR",
        decimals: 2,
      }),
    ).toBe("€1,234.50");
    expect(formatMeasureValue(null)).toBe("—");
    expect(formatMeasureValue(0)).toBe("0");
  });
});

it("keeps large integer pivot members distinct without losing precision", () => {
  const first = 9007199254740992n;
  const second = 9007199254740993n;
  const grid = buildReportGrid(
    [
      { field_month: first, field_channel: first, metric_rate: 0.2 },
      { field_month: second, field_channel: second, metric_rate: 0.3 },
      {
        field_month: String(first),
        field_channel: String(first),
        metric_rate: 0.4,
      },
    ],
    insight,
  );
  expect(grid.rows).toHaveLength(3);
  expect(grid.columns).toHaveLength(3);
  expect(grid.rows[0]!.cells[grid.columns[0]!.key]).toBe(0.2);
  expect(grid.rows[1]!.cells[grid.columns[1]!.key]).toBe(0.3);
  expect(formatMeasureValue(second, { style: "number", decimals: 0 })).toBe(
    "9,007,199,254,740,993",
  );
});
