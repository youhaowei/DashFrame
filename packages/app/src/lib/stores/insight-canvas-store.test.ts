import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  TABLE_CANVAS_VIEW,
  canvasViewsEqual,
  sanitizeInsightCanvasView,
  useInsightCanvasStore,
} from "./insight-canvas-store";

describe("insight canvas view state", () => {
  beforeEach(() => {
    useInsightCanvasStore.setState({
      activeViewByInsight: {},
      draftChartTypeByInsight: {},
    });
    useInsightCanvasStore.persist.clearStorage();
  });

  it("stores last active view per insight", () => {
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

  it("stores an inactive draft independently from the selected canvas tab", () => {
    useInsightCanvasStore.getState().setDraftChartType("insight-a", "line");
    useInsightCanvasStore
      .getState()
      .setActiveView("insight-a", TABLE_CANVAS_VIEW);

    expect(useInsightCanvasStore.getState()).toMatchObject({
      activeViewByInsight: { "insight-a": TABLE_CANVAS_VIEW },
      draftChartTypeByInsight: { "insight-a": "line" },
    });

    useInsightCanvasStore.getState().clearDraftChartType("insight-a");
    expect(
      useInsightCanvasStore.getState().draftChartTypeByInsight,
    ).not.toHaveProperty("insight-a");
  });

  it("migrates a legacy active chart into a draft that survives Data and remount", async () => {
    localStorage.setItem(
      "dashframe:insight-canvas",
      JSON.stringify({
        state: {
          activeViewByInsight: {
            "insight-a": { kind: "chart", chartType: "line" },
          },
        },
        version: 0,
      }),
    );

    await useInsightCanvasStore.persist.rehydrate();
    expect(useInsightCanvasStore.getState()).toMatchObject({
      activeViewByInsight: {
        "insight-a": { kind: "chart", chartType: "line" },
      },
      draftChartTypeByInsight: { "insight-a": "line" },
    });

    useInsightCanvasStore
      .getState()
      .setActiveView("insight-a", TABLE_CANVAS_VIEW);
    const persistedAfterSelectingData = localStorage.getItem(
      "dashframe:insight-canvas",
    );
    expect(persistedAfterSelectingData).toBeTruthy();

    // Simulate a fresh module/page state, then restore the payload written
    // after Data was selected and hydrate it as the next mount would.
    useInsightCanvasStore.setState({
      activeViewByInsight: {},
      draftChartTypeByInsight: {},
    });
    localStorage.setItem(
      "dashframe:insight-canvas",
      persistedAfterSelectingData ?? "",
    );
    await useInsightCanvasStore.persist.rehydrate();

    const remounted = useInsightCanvasStore.getState();
    expect(remounted.activeViewByInsight["insight-a"]).toEqual(
      TABLE_CANVAS_VIEW,
    );
    expect(remounted.draftChartTypeByInsight["insight-a"]).toBe("line");
    remounted.setActiveView("insight-a", {
      kind: "chart",
      chartType: remounted.draftChartTypeByInsight["insight-a"] ?? "barY",
    });
    expect(
      useInsightCanvasStore.getState().activeViewByInsight["insight-a"],
    ).toEqual({ kind: "chart", chartType: "line" });
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
