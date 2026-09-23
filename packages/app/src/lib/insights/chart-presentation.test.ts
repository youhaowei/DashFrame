import { describe, expect, it } from "vite-plus/test";
import type { Insight, VisualizationEncoding } from "@dashframe/types";
import {
  buildChartPresentation,
  resolveReportChartEncoding,
} from "./chart-presentation";

const insight: Insight = {
  id: "report",
  name: "Conversion",
  createdAt: 0,
  source: { sourceType: "dataTable", sourceId: "source" },
  selectedFields: ["date", "channel"],
  metrics: [
    {
      id: "rate",
      name: "Conversion",
      sourceTable: "source",
      aggregation: "count",
    },
  ],
};
const encoding: VisualizationEncoding = {
  x: "field:date",
  y: "metric:rate",
  xTransform: {
    type: "date",
    transform: { kind: "temporal", aggregation: "yearMonth" },
  },
};

describe("chart presentation grain", () => {
  it.each(["barY", "line"] as const)(
    "requests source reaggregation without an omitted channel for %s",
    (type) => {
      expect(buildChartPresentation(insight, encoding, type)).toEqual({
        dimensions: ["date"],
        transforms: { date: { kind: "temporal", aggregation: "yearMonth" } },
      });
      const resolved = resolveReportChartEncoding(
        encoding,
        {
          fields: [
            { id: "date", name: "Date", tableId: "source", type: "date" },
          ],
          metrics: insight.metrics ?? [],
        },
        true,
        type,
      );
      expect(resolved.x).toBe("field_date");
      expect(resolved.y).toBe("metric_rate");
    },
  );
  it("includes a drawn series dimension and only includes size for dots", () => {
    const colored = {
      ...encoding,
      color: "field:channel",
      size: "field:country",
    };
    expect(
      buildChartPresentation(insight, colored, "barY")?.dimensions,
    ).toEqual(["date", "channel"]);
    expect(buildChartPresentation(insight, colored, "dot")?.dimensions).toEqual(
      ["date", "channel", "country"],
    );
  });
  it("supports a single aggregate without dimensions", () => {
    expect(buildChartPresentation(insight, { y: "metric:rate" })).toEqual({
      dimensions: [],
    });
  });
  it("leaves raw previews on their existing path", () => {
    expect(
      buildChartPresentation({ ...insight, metrics: [] }, encoding),
    ).toBeUndefined();
  });
  it("rejects contradictory groupings of one field instead of silently choosing one", () => {
    expect(() =>
      buildChartPresentation(insight, { ...encoding, color: "field:date" }),
    ).toThrow("Use one date grouping");
  });
});
