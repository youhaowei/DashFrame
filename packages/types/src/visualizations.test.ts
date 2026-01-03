/**
 * Unit tests for visualizations module
 *
 * Tests cover:
 * - getAvailableTags() - Get all unique tags from chart type metadata
 * - getChartTypesForTag() - Get chart types filtered by tag
 * - getTagsForChartType() - Get tags for a specific chart type
 * - CHART_TYPE_METADATA - Chart type metadata constant
 */
import { describe, expect, it } from "vitest";
import type { ChartTag, VisualizationType } from "./visualizations";
import {
  CHART_TAG_METADATA,
  CHART_TYPE_METADATA,
  SCATTER_MAX_POINTS,
  getAvailableTags,
  getChartTypesForTag,
  getTagsForChartType,
} from "./visualizations";

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
        expect(CHART_TYPE_METADATA.barY.tags).toEqual([
          "comparison",
          "trend",
        ]);
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

  describe("CHART_TAG_METADATA", () => {
    it("should have metadata for all tags", () => {
      const expectedTags: ChartTag[] = [
        "comparison",
        "trend",
        "correlation",
        "distribution",
      ];

      expectedTags.forEach((tag) => {
        expect(CHART_TAG_METADATA[tag]).toBeDefined();
      });
    });

    it("should have complete metadata structure for each tag", () => {
      const tags = Object.keys(CHART_TAG_METADATA) as ChartTag[];

      tags.forEach((tag) => {
        const meta = CHART_TAG_METADATA[tag];
        expect(meta).toHaveProperty("displayName");
        expect(meta).toHaveProperty("description");
        expect(typeof meta.displayName).toBe("string");
        expect(typeof meta.description).toBe("string");
        expect(meta.displayName.length).toBeGreaterThan(0);
        expect(meta.description.length).toBeGreaterThan(0);
      });
    });

    it("should have descriptive names and descriptions", () => {
      expect(CHART_TAG_METADATA.comparison.displayName).toBe("Comparison");
      expect(CHART_TAG_METADATA.comparison.description).toContain("Compare");

      expect(CHART_TAG_METADATA.trend.displayName).toBe("Trend");
      expect(CHART_TAG_METADATA.trend.description).toContain("time");

      expect(CHART_TAG_METADATA.correlation.displayName).toBe("Correlation");
      expect(CHART_TAG_METADATA.correlation.description).toContain(
        "relationships",
      );

      expect(CHART_TAG_METADATA.distribution.displayName).toBe("Distribution");
      expect(CHART_TAG_METADATA.distribution.description).toContain("spread");
    });
  });

  describe("SCATTER_MAX_POINTS", () => {
    it("should be defined", () => {
      expect(SCATTER_MAX_POINTS).toBeDefined();
    });

    it("should be a positive number", () => {
      expect(typeof SCATTER_MAX_POINTS).toBe("number");
      expect(SCATTER_MAX_POINTS).toBeGreaterThan(0);
    });

    it("should be 5000", () => {
      expect(SCATTER_MAX_POINTS).toBe(5000);
    });
  });

  describe("getAvailableTags()", () => {
    it("should return an array of tags", () => {
      const tags = getAvailableTags();
      expect(Array.isArray(tags)).toBe(true);
      expect(tags.length).toBeGreaterThan(0);
    });

    it("should return all tags used in CHART_TYPE_METADATA", () => {
      const tags = getAvailableTags();
      expect(tags).toContain("comparison");
      expect(tags).toContain("trend");
      expect(tags).toContain("correlation");
      expect(tags).toContain("distribution");
    });

    it("should return unique tags (no duplicates)", () => {
      const tags = getAvailableTags();
      const uniqueTags = new Set(tags);
      expect(tags.length).toBe(uniqueTags.size);
    });

    it("should return exactly 4 tags", () => {
      const tags = getAvailableTags();
      expect(tags.length).toBe(4);
    });

    it("should return the same tags on multiple calls", () => {
      const tags1 = getAvailableTags();
      const tags2 = getAvailableTags();

      // Sort both arrays for comparison
      tags1.sort();
      tags2.sort();

      expect(tags1).toEqual(tags2);
    });

    it("should only include tags that have at least one chart type", () => {
      const tags = getAvailableTags();

      tags.forEach((tag) => {
        const chartTypes = getChartTypesForTag(tag);
        expect(chartTypes.length).toBeGreaterThan(0);
      });
    });
  });

  describe("getChartTypesForTag()", () => {
    describe("comparison tag", () => {
      it("should return chart types with comparison tag", () => {
        const types = getChartTypesForTag("comparison");
        expect(Array.isArray(types)).toBe(true);
        expect(types.length).toBeGreaterThan(0);
      });

      it("should include barY and barX", () => {
        const types = getChartTypesForTag("comparison");
        expect(types).toContain("barY");
        expect(types).toContain("barX");
      });

      it("should only include chart types that have comparison tag", () => {
        const types = getChartTypesForTag("comparison");
        types.forEach((type) => {
          expect(CHART_TYPE_METADATA[type].tags).toContain("comparison");
        });
      });
    });

    describe("trend tag", () => {
      it("should return chart types with trend tag", () => {
        const types = getChartTypesForTag("trend");
        expect(Array.isArray(types)).toBe(true);
        expect(types.length).toBeGreaterThan(0);
      });

      it("should include barY, line, and areaY", () => {
        const types = getChartTypesForTag("trend");
        expect(types).toContain("barY");
        expect(types).toContain("line");
        expect(types).toContain("areaY");
      });

      it("should only include chart types that have trend tag", () => {
        const types = getChartTypesForTag("trend");
        types.forEach((type) => {
          expect(CHART_TYPE_METADATA[type].tags).toContain("trend");
        });
      });
    });

    describe("correlation tag", () => {
      it("should return chart types with correlation tag", () => {
        const types = getChartTypesForTag("correlation");
        expect(Array.isArray(types)).toBe(true);
        expect(types.length).toBeGreaterThan(0);
      });

      it("should include dot, hexbin, heatmap, and raster", () => {
        const types = getChartTypesForTag("correlation");
        expect(types).toContain("dot");
        expect(types).toContain("hexbin");
        expect(types).toContain("heatmap");
        expect(types).toContain("raster");
      });

      it("should only include chart types that have correlation tag", () => {
        const types = getChartTypesForTag("correlation");
        types.forEach((type) => {
          expect(CHART_TYPE_METADATA[type].tags).toContain("correlation");
        });
      });
    });

    describe("distribution tag", () => {
      it("should return chart types with distribution tag", () => {
        const types = getChartTypesForTag("distribution");
        expect(Array.isArray(types)).toBe(true);
        expect(types.length).toBeGreaterThan(0);
      });

      it("should include hexbin and heatmap", () => {
        const types = getChartTypesForTag("distribution");
        expect(types).toContain("hexbin");
        expect(types).toContain("heatmap");
      });

      it("should only include chart types that have distribution tag", () => {
        const types = getChartTypesForTag("distribution");
        types.forEach((type) => {
          expect(CHART_TYPE_METADATA[type].tags).toContain("distribution");
        });
      });
    });

    describe("edge cases", () => {
      it("should return unique chart types (no duplicates)", () => {
        const tags = getAvailableTags();
        tags.forEach((tag) => {
          const types = getChartTypesForTag(tag);
          const uniqueTypes = new Set(types);
          expect(types.length).toBe(uniqueTypes.size);
        });
      });

      it("should return consistent results on multiple calls", () => {
        const tags = getAvailableTags();
        tags.forEach((tag) => {
          const types1 = getChartTypesForTag(tag);
          const types2 = getChartTypesForTag(tag);

          // Sort both arrays for comparison
          types1.sort();
          types2.sort();

          expect(types1).toEqual(types2);
        });
      });
    });
  });

  describe("getTagsForChartType()", () => {
    describe("barY chart type", () => {
      it("should return tags for barY", () => {
        const tags = getTagsForChartType("barY");
        expect(Array.isArray(tags)).toBe(true);
        expect(tags.length).toBeGreaterThan(0);
      });

      it("should include comparison and trend tags", () => {
        const tags = getTagsForChartType("barY");
        expect(tags).toContain("comparison");
        expect(tags).toContain("trend");
        expect(tags.length).toBe(2);
      });
    });

    describe("barX chart type", () => {
      it("should return tags for barX", () => {
        const tags = getTagsForChartType("barX");
        expect(Array.isArray(tags)).toBe(true);
        expect(tags.length).toBeGreaterThan(0);
      });

      it("should include only comparison tag", () => {
        const tags = getTagsForChartType("barX");
        expect(tags).toContain("comparison");
        expect(tags.length).toBe(1);
      });
    });

    describe("line chart type", () => {
      it("should return tags for line", () => {
        const tags = getTagsForChartType("line");
        expect(Array.isArray(tags)).toBe(true);
        expect(tags.length).toBeGreaterThan(0);
      });

      it("should include only trend tag", () => {
        const tags = getTagsForChartType("line");
        expect(tags).toContain("trend");
        expect(tags.length).toBe(1);
      });
    });

    describe("areaY chart type", () => {
      it("should return tags for areaY", () => {
        const tags = getTagsForChartType("areaY");
        expect(Array.isArray(tags)).toBe(true);
        expect(tags.length).toBeGreaterThan(0);
      });

      it("should include only trend tag", () => {
        const tags = getTagsForChartType("areaY");
        expect(tags).toContain("trend");
        expect(tags.length).toBe(1);
      });
    });

    describe("dot chart type", () => {
      it("should return tags for dot", () => {
        const tags = getTagsForChartType("dot");
        expect(Array.isArray(tags)).toBe(true);
        expect(tags.length).toBeGreaterThan(0);
      });

      it("should include only correlation tag", () => {
        const tags = getTagsForChartType("dot");
        expect(tags).toContain("correlation");
        expect(tags.length).toBe(1);
      });
    });

    describe("hexbin chart type", () => {
      it("should return tags for hexbin", () => {
        const tags = getTagsForChartType("hexbin");
        expect(Array.isArray(tags)).toBe(true);
        expect(tags.length).toBeGreaterThan(0);
      });

      it("should include correlation and distribution tags", () => {
        const tags = getTagsForChartType("hexbin");
        expect(tags).toContain("correlation");
        expect(tags).toContain("distribution");
        expect(tags.length).toBe(2);
      });
    });

    describe("heatmap chart type", () => {
      it("should return tags for heatmap", () => {
        const tags = getTagsForChartType("heatmap");
        expect(Array.isArray(tags)).toBe(true);
        expect(tags.length).toBeGreaterThan(0);
      });

      it("should include correlation and distribution tags", () => {
        const tags = getTagsForChartType("heatmap");
        expect(tags).toContain("correlation");
        expect(tags).toContain("distribution");
        expect(tags.length).toBe(2);
      });
    });

    describe("raster chart type", () => {
      it("should return tags for raster", () => {
        const tags = getTagsForChartType("raster");
        expect(Array.isArray(tags)).toBe(true);
        expect(tags.length).toBeGreaterThan(0);
      });

      it("should include only correlation tag", () => {
        const tags = getTagsForChartType("raster");
        expect(tags).toContain("correlation");
        expect(tags.length).toBe(1);
      });
    });

    describe("edge cases", () => {
      it("should return reference to actual metadata tags array", () => {
        const tags = getTagsForChartType("barY");
        expect(tags).toBe(CHART_TYPE_METADATA.barY.tags);
      });

      it("should return consistent results on multiple calls", () => {
        const chartTypes: VisualizationType[] = [
          "barY",
          "barX",
          "line",
          "areaY",
          "dot",
          "hexbin",
          "heatmap",
          "raster",
        ];

        chartTypes.forEach((type) => {
          const tags1 = getTagsForChartType(type);
          const tags2 = getTagsForChartType(type);
          expect(tags1).toEqual(tags2);
        });
      });
    });
  });

  describe("integration - tag and chart type relationships", () => {
    it("should have bidirectional consistency between tags and chart types", () => {
      const tags = getAvailableTags();

      tags.forEach((tag) => {
        const chartTypes = getChartTypesForTag(tag);

        // Each chart type returned by getChartTypesForTag should have the tag
        chartTypes.forEach((type) => {
          const tagsForType = getTagsForChartType(type);
          expect(tagsForType).toContain(tag);
        });
      });
    });

    it("should ensure every chart type is included in at least one tag", () => {
      const allChartTypes: VisualizationType[] = [
        "barY",
        "barX",
        "line",
        "areaY",
        "dot",
        "hexbin",
        "heatmap",
        "raster",
      ];
      const tags = getAvailableTags();
      const chartTypesWithTags = new Set<VisualizationType>();

      tags.forEach((tag) => {
        const chartTypes = getChartTypesForTag(tag);
        chartTypes.forEach((type) => chartTypesWithTags.add(type));
      });

      allChartTypes.forEach((type) => {
        expect(chartTypesWithTags.has(type)).toBe(true);
      });
    });

    it("should verify tag filtering returns correct subsets", () => {
      const allChartTypes: VisualizationType[] = [
        "barY",
        "barX",
        "line",
        "areaY",
        "dot",
        "hexbin",
        "heatmap",
        "raster",
      ];

      // Comparison charts should be a subset of all charts
      const comparisonCharts = getChartTypesForTag("comparison");
      expect(comparisonCharts.length).toBeLessThan(allChartTypes.length);

      // Same for other tags
      const trendCharts = getChartTypesForTag("trend");
      expect(trendCharts.length).toBeLessThan(allChartTypes.length);

      const correlationCharts = getChartTypesForTag("correlation");
      expect(correlationCharts.length).toBeLessThan(allChartTypes.length);
    });

    it("should verify some chart types appear in multiple tags", () => {
      const tags = getAvailableTags();
      const chartTypeCount = new Map<VisualizationType, number>();

      tags.forEach((tag) => {
        const chartTypes = getChartTypesForTag(tag);
        chartTypes.forEach((type) => {
          chartTypeCount.set(type, (chartTypeCount.get(type) ?? 0) + 1);
        });
      });

      // Find chart types that appear in multiple tags
      const multiTagChartTypes = Array.from(chartTypeCount.entries()).filter(
        ([_, count]) => count > 1,
      );

      expect(multiTagChartTypes.length).toBeGreaterThan(0);

      // Verify specific examples
      expect(chartTypeCount.get("barY")).toBeGreaterThan(1);
      expect(chartTypeCount.get("hexbin")).toBeGreaterThan(1);
      expect(chartTypeCount.get("heatmap")).toBeGreaterThan(1);
    });
  });

  describe("type safety", () => {
    it("should only accept valid tags for getChartTypesForTag", () => {
      const validTags: ChartTag[] = [
        "comparison",
        "trend",
        "correlation",
        "distribution",
      ];

      validTags.forEach((tag) => {
        const result = getChartTypesForTag(tag);
        expect(Array.isArray(result)).toBe(true);
      });
    });

    it("should only accept valid chart types for getTagsForChartType", () => {
      const validTypes: VisualizationType[] = [
        "barY",
        "barX",
        "line",
        "areaY",
        "dot",
        "hexbin",
        "heatmap",
        "raster",
      ];

      validTypes.forEach((type) => {
        const result = getTagsForChartType(type);
        expect(Array.isArray(result)).toBe(true);
      });
    });

    it("should return arrays of correct types", () => {
      const tags = getAvailableTags();
      tags.forEach((tag) => {
        expect(typeof tag).toBe("string");
      });

      const types = getChartTypesForTag("comparison");
      types.forEach((type) => {
        expect(typeof type).toBe("string");
      });

      const tagsForBarY = getTagsForChartType("barY");
      tagsForBarY.forEach((tag) => {
        expect(typeof tag).toBe("string");
      });
    });
  });
});
