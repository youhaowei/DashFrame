/**
 * Unit tests for visualizations module
 *
 * Tests cover:
 * - CHART_TYPE_METADATA - Chart type metadata constant
 */
import { describe, expect, it } from "vite-plus/test";
import type { VisualizationType } from "./visualizations";
import { CHART_TYPE_METADATA } from "./visualizations";

type ChartTag = (typeof CHART_TYPE_METADATA)[VisualizationType]["tags"][number];

describe("visualizations", () => {
  describe("CHART_TYPE_METADATA", () => {
    describe("metadata structure", () => {
      it("should have metadata for all chart types", () => {
        const expectedTypes: VisualizationType[] = [
          "barY",
          "barX",
          "line",
          "areaY",
          "dot",
          "hexbin",
          "heatmap",
          "raster",
        ];

        expectedTypes.forEach((type) => {
          expect(CHART_TYPE_METADATA[type]).toBeDefined();
        });
      });

      it("should have complete metadata structure for each chart type", () => {
        const chartTypes = Object.keys(
          CHART_TYPE_METADATA,
        ) as VisualizationType[];

        chartTypes.forEach((type) => {
          const meta = CHART_TYPE_METADATA[type];
          expect(meta).toHaveProperty("tags");
          expect(meta).toHaveProperty("displayName");
          expect(meta).toHaveProperty("description");
          expect(meta).toHaveProperty("hint");
          expect(Array.isArray(meta.tags)).toBe(true);
          expect(typeof meta.displayName).toBe("string");
          expect(typeof meta.description).toBe("string");
          expect(typeof meta.hint).toBe("string");
        });
      });

      it("should have non-empty values for all metadata fields", () => {
        const chartTypes = Object.keys(
          CHART_TYPE_METADATA,
        ) as VisualizationType[];

        chartTypes.forEach((type) => {
          const meta = CHART_TYPE_METADATA[type];
          expect(meta.tags.length).toBeGreaterThan(0);
          expect(meta.displayName.length).toBeGreaterThan(0);
          expect(meta.description.length).toBeGreaterThan(0);
          expect(meta.hint.length).toBeGreaterThan(0);
        });
      });
    });

    describe("barY metadata", () => {
      it("should have correct tags", () => {
        expect(CHART_TYPE_METADATA.barY.tags).toEqual(["comparison", "trend"]);
      });

      it("should have correct display name", () => {
        expect(CHART_TYPE_METADATA.barY.displayName).toBe("Bar");
      });

      it("should have descriptive text", () => {
        expect(CHART_TYPE_METADATA.barY.description).toContain("bars");
        expect(CHART_TYPE_METADATA.barY.hint).toContain("Compare");
      });
    });

    describe("barX metadata", () => {
      it("should have correct tags", () => {
        expect(CHART_TYPE_METADATA.barX.tags).toEqual(["comparison"]);
      });

      it("should have correct display name", () => {
        expect(CHART_TYPE_METADATA.barX.displayName).toBe("Horizontal bar");
      });

      it("should have descriptive text", () => {
        expect(CHART_TYPE_METADATA.barX.description).toContain("Horizontal");
        expect(CHART_TYPE_METADATA.barX.hint).toContain("ranking");
      });
    });

    describe("line metadata", () => {
      it("should have correct tags", () => {
        expect(CHART_TYPE_METADATA.line.tags).toEqual(["trend"]);
      });

      it("should have correct display name", () => {
        expect(CHART_TYPE_METADATA.line.displayName).toBe("Line");
      });

      it("should have descriptive text", () => {
        expect(CHART_TYPE_METADATA.line.description).toContain("trends");
        expect(CHART_TYPE_METADATA.line.hint).toContain("time");
      });
    });

    describe("areaY metadata", () => {
      it("should have correct tags", () => {
        expect(CHART_TYPE_METADATA.areaY.tags).toEqual(["trend"]);
      });

      it("should have correct display name", () => {
        expect(CHART_TYPE_METADATA.areaY.displayName).toBe("Area");
      });

      it("should have descriptive text", () => {
        expect(CHART_TYPE_METADATA.areaY.description).toContain("area");
        expect(CHART_TYPE_METADATA.areaY.hint).toContain("cumulative");
      });
    });

    describe("dot metadata", () => {
      it("should have correct tags", () => {
        expect(CHART_TYPE_METADATA.dot.tags).toEqual(["correlation"]);
      });

      it("should have correct display name", () => {
        expect(CHART_TYPE_METADATA.dot.displayName).toBe("Scatter");
      });

      it("should have descriptive text", () => {
        expect(CHART_TYPE_METADATA.dot.description).toContain("correlation");
        expect(CHART_TYPE_METADATA.dot.hint).toContain("5K");
      });
    });

    describe("hexbin metadata", () => {
      it("should have correct tags", () => {
        expect(CHART_TYPE_METADATA.hexbin.tags).toEqual([
          "correlation",
          "distribution",
        ]);
      });

      it("should have correct display name", () => {
        expect(CHART_TYPE_METADATA.hexbin.displayName).toBe("Hexbin");
      });

      it("should have descriptive text", () => {
        expect(CHART_TYPE_METADATA.hexbin.description).toContain("Density");
        expect(CHART_TYPE_METADATA.hexbin.hint).toContain("hex");
      });
    });

    describe("heatmap metadata", () => {
      it("should have correct tags", () => {
        expect(CHART_TYPE_METADATA.heatmap.tags).toEqual([
          "correlation",
          "distribution",
        ]);
      });

      it("should have correct display name", () => {
        expect(CHART_TYPE_METADATA.heatmap.displayName).toBe("Heatmap");
      });

      it("should have descriptive text", () => {
        expect(CHART_TYPE_METADATA.heatmap.description).toContain("density");
        expect(CHART_TYPE_METADATA.heatmap.hint).toContain("clusters");
      });
    });

    describe("raster metadata", () => {
      it("should have correct tags", () => {
        expect(CHART_TYPE_METADATA.raster.tags).toEqual(["correlation"]);
      });

      it("should have correct display name", () => {
        expect(CHART_TYPE_METADATA.raster.displayName).toBe("Raster");
      });

      it("should have descriptive text", () => {
        expect(CHART_TYPE_METADATA.raster.description).toContain("Pixel");
        expect(CHART_TYPE_METADATA.raster.hint).toContain("100K");
      });
    });

    describe("tag usage across chart types", () => {
      it("should use all available tags", () => {
        const allTags = new Set<ChartTag>();
        const chartTypes = Object.keys(
          CHART_TYPE_METADATA,
        ) as VisualizationType[];

        chartTypes.forEach((type) => {
          CHART_TYPE_METADATA[type].tags.forEach((tag) => allTags.add(tag));
        });

        expect(allTags.has("comparison")).toBe(true);
        expect(allTags.has("trend")).toBe(true);
        expect(allTags.has("correlation")).toBe(true);
        expect(allTags.has("distribution")).toBe(true);
      });

      it("should have multiple chart types for some tags", () => {
        const tagCounts = new Map<ChartTag, number>();
        const chartTypes = Object.keys(
          CHART_TYPE_METADATA,
        ) as VisualizationType[];

        chartTypes.forEach((type) => {
          CHART_TYPE_METADATA[type].tags.forEach((tag) => {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
          });
        });

        // Verify specific tags have multiple chart types
        expect(tagCounts.get("correlation")!).toBeGreaterThan(1);
        expect(tagCounts.get("trend")!).toBeGreaterThan(1);
        expect(tagCounts.get("comparison")!).toBeGreaterThan(1);
      });

      it("should allow chart types to have multiple tags", () => {
        const multiTagTypes = (
          Object.keys(CHART_TYPE_METADATA) as VisualizationType[]
        ).filter((type) => CHART_TYPE_METADATA[type].tags.length > 1);

        expect(multiTagTypes.length).toBeGreaterThan(0);
        // Verify specific examples
        expect(CHART_TYPE_METADATA.barY.tags.length).toBeGreaterThan(1);
        expect(CHART_TYPE_METADATA.hexbin.tags.length).toBeGreaterThan(1);
      });
    });
  });
});
