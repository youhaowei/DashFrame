import { describe, expect, it } from "vite-plus/test";
import { sanitizeInsightCanvasView, TABLE_CANVAS_VIEW } from "./canvas-view";

describe("sanitizeInsightCanvasView", () => {
  const chart = { kind: "visualization" as const, visualizationId: "viz-1" };

  it("keeps a chart that still exists", () => {
    expect(sanitizeInsightCanvasView(chart, new Set(["viz-1"]))).toBe(chart);
  });

  it("shows the data when the chart is gone", () => {
    expect(sanitizeInsightCanvasView(chart, new Set())).toBe(TABLE_CANVAS_VIEW);
  });

  it("shows the data when no view is given", () => {
    expect(sanitizeInsightCanvasView(undefined, new Set())).toBe(
      TABLE_CANVAS_VIEW,
    );
  });
});
