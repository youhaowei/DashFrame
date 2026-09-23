import { reportMeasureFormats } from "@dashframe/engine";
import { describe, expect, it } from "vite-plus/test";
import type { Field, Insight, VisualizationEncoding } from "@dashframe/types";
import {
  currentViewerRuntime,
  reportEncoding,
  reportPresentation,
} from "./report-runtime";
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
  { id: "product", name: "Product", tableId: "source", type: "string" },
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
  it("rebinds removed dimensions one-to-one by their saved positions", () => {
    const result = reportEncoding(
      {
        x: "field:date",
        xType: "temporal",
        xTransform: {
          type: "date",
          transform: { kind: "temporal", aggregation: "month" },
        },
        color: "field:channel",
      },
      insight,
      { dimensions: ["country", "product"] },
      fields,
    );

    expect(result).toMatchObject({
      x: "field:country",
      xType: "nominal",
      xTransform: undefined,
      color: "field:product",
    });
  });
  it("preserves selected dimensions and clears a surplus removed channel", () => {
    const result = reportEncoding(
      {
        x: "field:date",
        xType: "temporal",
        color: "field:channel",
      },
      insight,
      { dimensions: ["channel"] },
      fields,
    );

    expect(result.x).toBeUndefined();
    expect(result.xType).toBeUndefined();
    expect(result.xTransform).toBeUndefined();
    expect(result.color).toBe("field:channel");
  });
  it("rebinds removed measures one-to-one and clears surplus channels", () => {
    const replacements = reportEncoding(
      {
        y: "metric:orders",
        size: "metric:rate",
      },
      insight,
      { measures: ["revenue", "profit"] },
      fields,
    );

    expect(replacements.y).toBe("metric:revenue");
    expect(replacements.size).toBe("metric:profit");

    const result = reportEncoding(
      {
        y: "metric:orders",
        size: "metric:rate",
      },
      insight,
      { measures: ["rate"] },
      fields,
    );

    expect(result.y).toBeUndefined();
    expect(result.size).toBe("metric:rate");
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

describe("currentViewerRuntime", () => {
  const saved = {
    id: "report",
    name: "Report",
    source: { sourceType: "dataTable", sourceId: "source" },
    selectedFields: ["region", "date"],
    metrics: [],
    runtimeControls: {
      dimensions: { allowedIds: ["date", "product"], maxSelected: 2 },
    },
    createdAt: 0,
  } as unknown as Insight;

  it("keeps a viewer's picks valid after the author adds a field", () => {
    // The viewer hid date while the report showed region and date.
    const runtime = { dimensions: ["region"] };
    const edited = {
      ...saved,
      selectedFields: ["region", "date", "country"],
    } as Insight;
    expect(currentViewerRuntime(edited, runtime)).toEqual({
      dimensions: ["region", "country"],
    });
  });

  it("drops picks that are no longer viewer choices", () => {
    const runtime = { dimensions: ["region", "date", "product"] };
    const narrowed = {
      ...saved,
      runtimeControls: {
        dimensions: { allowedIds: ["date"], maxSelected: 1 },
      },
    } as unknown as Insight;
    expect(currentViewerRuntime(narrowed, runtime)).toEqual({
      dimensions: ["region", "date"],
    });
    const closed = { ...saved, runtimeControls: undefined } as Insight;
    expect(currentViewerRuntime(closed, runtime)).toEqual({});
  });
});

describe("reportEncoding with fixed selections", () => {
  it("swaps a viewer choice without handing its channel to a fixed field", () => {
    const report = {
      id: "report",
      name: "Report",
      source: { sourceType: "dataTable", sourceId: "source" },
      selectedFields: ["date", "channel"],
      metrics: [],
      runtimeControls: {
        dimensions: { allowedIds: ["channel", "country"], maxSelected: 1 },
      },
      createdAt: 0,
    } as unknown as Insight;
    const fields = [
      { id: "date", name: "Date", type: "date", tableId: "source" },
      { id: "channel", name: "Channel", type: "string", tableId: "source" },
      { id: "country", name: "Country", type: "string", tableId: "source" },
    ] as Field[];
    // Date is fixed and not encoded; the viewer swaps Channel for Country.
    expect(
      reportEncoding(
        { color: "field:channel" },
        report,
        { dimensions: ["date", "country"] },
        fields,
      ),
    ).toEqual({ color: "field:country" });
  });

  it("keeps a viewer's picks valid after the author fixes a hidden choice", () => {
    const report = {
      id: "report",
      name: "Report",
      source: { sourceType: "dataTable", sourceId: "source" },
      selectedFields: ["date", "channel"],
      metrics: [],
      // Channel stopped being a viewer choice after the viewer hid it.
      runtimeControls: {
        dimensions: { allowedIds: ["date"], maxSelected: 1 },
      },
      createdAt: 0,
    } as unknown as Insight;
    expect(currentViewerRuntime(report, { dimensions: ["date"] })).toEqual({
      dimensions: ["date", "channel"],
    });
  });
});
