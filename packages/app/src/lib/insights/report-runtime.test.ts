import { reportMeasureFormats } from "@dashframe/engine";
import { describe, expect, it } from "vite-plus/test";
import type { Field, Insight, VisualizationEncoding } from "@dashframe/types";
import { reportEncoding, reportPresentation } from "./report-runtime";
const insight: Insight = {
  id: "report",
  name: "Report",
  source: { sourceType: "dataTable", sourceId: "source" },
  selectedFields: ["date", "channel"],
  metrics: [
    {
      id: "orders",
      name: "Orders",
      sourceTable: "source",
      aggregation: "count",
    },
    { id: "rate", name: "Rate", sourceTable: "source", aggregation: "count" },
  ],
  reporting: {
    totals: true,
    pivotFields: ["channel"],
    dateGrains: { date: "month" },
  },
  createdAt: 0,
};
const fields: Field[] = [
  { id: "country", name: "Country", tableId: "source", type: "string" },
];
describe("report runtime presentation", () => {
  it("keeps query dependencies but projects selected measures and dimensions without changing the saved report", () => {
    const before = JSON.stringify(insight);
    const result = reportPresentation(insight, {
      dimensions: ["date", "country"],
      measures: ["rate"],
    });
    expect(result.selectedFields).toEqual(["date", "country"]);
    expect(result.reporting?.measureIds).toEqual(["rate"]);
    expect(result.reporting?.pivotFields).toEqual([]);
    expect(result.metrics).toHaveLength(2);
    expect(JSON.stringify(insight)).toBe(before);
  });
  it("rebinds a removed breakdown and measure while retaining the monthly date axis", () => {
    const encoding: VisualizationEncoding = {
      x: "field:date",
      xType: "temporal",
      xTransform: {
        type: "date",
        transform: { kind: "temporal", aggregation: "month" },
      },
      color: "field:channel",
      y: "metric:orders",
    };
    const result = reportEncoding(
      encoding,
      insight,
      { dimensions: ["date", "country"], measures: ["rate"] },
      fields,
    );
    expect(result).toMatchObject({
      x: "field:date",
      color: "field:country",
      y: "metric:rate",
      xTransform: encoding.xTransform,
    });
    expect(encoding.color).toBe("field:channel");
  });
  it("clears an obsolete date transform when replacing a temporal axis with country", () => {
    const result = reportEncoding(
      { x: "field:date", xType: "temporal" },
      insight,
      { dimensions: ["country"] },
      fields,
    );
    expect(result).toMatchObject({
      x: "field:country",
      xType: "nominal",
      xTransform: undefined,
    });
  });
});

it("preserves the selected measure's percent format when a viewer switches from orders to conversion", () => {
  const formatted: Insight = {
    ...insight,
    metrics: insight.metrics.map((metric) =>
      metric.id === "rate"
        ? { ...metric, format: { style: "percent", decimals: 1 } }
        : metric,
    ),
  };
  const runtime = { measures: ["rate"] };
  const presentation = reportPresentation(formatted, runtime);
  const encoding = reportEncoding(
    { y: "metric:orders" },
    formatted,
    runtime,
    fields,
  );
  expect(encoding.y).toBe("metric:rate");
  expect(reportMeasureFormats(presentation).metric_rate).toEqual({
    style: "percent",
    decimals: 1,
  });
  expect(reportMeasureFormats(presentation).metric_orders).toEqual({
    style: "number",
  });
});
