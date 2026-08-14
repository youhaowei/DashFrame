import { describe, expect, it } from "vite-plus/test";
import {
  TABLE_CANVAS_VIEW,
  canvasViewsEqual,
  sanitizeInsightCanvasView,
  useInsightCanvasStore,
} from "./insight-canvas-store";

describe("insight canvas view state", () => {
  it("stores last active view per insight", () => {
    useInsightCanvasStore.setState({ activeViewByInsight: {} });

    useInsightCanvasStore
      .getState()
      .setActiveView("insight-a", { kind: "chart", chartType: "barY" });
    useInsightCanvasStore
      .getState()
      .setActiveView("insight-b", { kind: "table" });

    expect(useInsightCanvasStore.getState().activeViewByInsight).toMatchObject({
      "insight-a": { kind: "chart", chartType: "barY" },
      "insight-b": { kind: "table" },
    });
  });

  it("falls back to table when a persisted pinned visualization no longer exists", () => {
    expect(
      sanitizeInsightCanvasView(
        { kind: "visualization", visualizationId: "missing-viz" },
        new Set(["other-viz"]),
      ),
    ).toEqual(TABLE_CANVAS_VIEW);
  });

  it("compares chart and pinned visualization views by payload", () => {
    expect(
      canvasViewsEqual(
        { kind: "chart", chartType: "line" },
        { kind: "chart", chartType: "line" },
      ),
    ).toBe(true);
    expect(
      canvasViewsEqual(
        { kind: "visualization", visualizationId: "viz-a" },
        { kind: "visualization", visualizationId: "viz-b" },
      ),
    ).toBe(false);
  });
});
