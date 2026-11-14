import { describe, expect, it } from "vite-plus/test";
import type { VisualizationType } from "./visualizations";
import { CHART_TYPE_METADATA, chartTypeDraws } from "./visualizations";

describe("visualizations", () => {
  describe("chartTypeDraws", () => {
    const chartTypes = Object.keys(CHART_TYPE_METADATA) as VisualizationType[];

    it("draws no color on the charts that fill by density", () => {
      expect(
        chartTypes.filter((type) => !chartTypeDraws(type, "color")),
      ).toEqual(["hexbin", "heatmap", "raster"]);
    });

    it("draws nothing for a chart type it does not know", () => {
      expect(chartTypeDraws("pie" as VisualizationType, "x")).toBe(false);
    });
  });
});
