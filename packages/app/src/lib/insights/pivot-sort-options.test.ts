import { describe, expect, it } from "vite-plus/test";
import type { Insight } from "@dashframe/types";
import { buildPivotSortOptions, reportSortKey } from "./pivot-sort-options";
const insight: Insight = {
  id: "report",
  name: "Revenue",
  source: { sourceType: "dataTable", sourceId: "table" },
  selectedFields: ["month", "channel"],
  metrics: [
    {
      id: "revenue",
      name: "Revenue",
      sourceTable: "table",
      aggregation: "sum",
    },
  ],
  reporting: { pivotFields: ["channel"] },
  createdAt: 0,
};
describe("pivot sort choices", () => {
  it("lists distinct canonical pivot cells and excludes total rows", () => {
    const options = buildPivotSortOptions(insight, [
      { field_channel: "Web" },
      { field_channel: "Web" },
      { field_channel: null },
      { field_channel: "Store", __report_grouping: 1 },
    ]);
    expect(options.map((option) => option.label)).toEqual([
      "Revenue · Web",
      "Revenue · (empty)",
    ]);
    expect(options[0]?.pivotValues).toEqual([
      { fieldId: "channel", value: "Web" },
    ]);
    expect(reportSortKey(options[0]!)).not.toBe(
      reportSortKey({ field: "metric_revenue" }),
    );
  });
  it("serializes grouped Arrow dates as ISO values and formats monthly labels", () => {
    const options = buildPivotSortOptions(
      {
        ...insight,
        reporting: { pivotFields: ["month"], dateGrains: { month: "month" } },
      },
      [{ field_month: Date.UTC(2026, 0, 1) }],
    );
    expect(options[0]?.label).toBe("Revenue · 2026-01");
    expect(options[0]?.pivotValues).toEqual([
      { fieldId: "month", value: "2026-01-01T00:00:00.000Z" },
    ]);
  });
});
