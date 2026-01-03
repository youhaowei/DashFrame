/**
 * Unit tests for auto-select module
 *
 * Tests cover:
 * - autoSelectEncoding() - Automatic field selection for chart encodings
 *   - Column analysis creation from DataFrame
 *   - Chart type-specific encoding selection (barY, barX, line, areaY, dot)
 *   - Metric preference for Y-axis
 *   - Temporal vs categorical preference for X-axis
 *   - Current encoding preservation when valid
 *   - Fallback strategies for missing columns
 */
import { describe, expect, it } from "vitest";
import type { DataFrameData, Field, UUID } from "@dashframe/types";
import type { Insight } from "../stores/types";
import { autoSelectEncoding } from "./auto-select";

describe("auto-select", () => {
  // ============================================================================
  // Mock Data Helpers
  // ============================================================================

  const createDataFrame = (
    columns: Array<{ name: string; type: string }>,
  ): DataFrameData => ({
    rows: [],
    columns: columns.map((col) => ({
      name: col.name,
      type: col.type as "string" | "number" | "boolean" | "date" | "unknown",
    })),
  });

  const createInsight = (metricNames: string[]): Insight => ({
    id: "insight123" as UUID,
    name: "Test Insight",
    baseTable: {
      type: "single",
      dataTableId: "table123" as UUID,
    },
    fields: [],
    metrics: metricNames.map((name) => ({
      id: `metric-${name}` as UUID,
      name,
      aggregation: "sum",
      fieldId: `field-${name}` as UUID,
    })),
    filters: [],
    createdAt: Date.now(),
  });

  // ============================================================================
  // Column Analysis Creation
  // ============================================================================

  describe("Column Analysis Creation", () => {
    it("should create numerical analysis for number types", () => {
      const dataFrame = createDataFrame([{ name: "revenue", type: "number" }]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      // Should select number column for Y-axis
      expect(encoding.y).toBe("revenue");
    });

    it("should create numerical analysis for integer types", () => {
      const dataFrame = createDataFrame([
        { name: "count", type: "integer" },
        { name: "category", type: "string" },
      ]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      // Should select integer column for Y-axis
      expect(encoding.y).toBe("count");
    });

    it("should create numerical analysis for float types", () => {
      const dataFrame = createDataFrame([{ name: "price", type: "float" }]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      expect(encoding.y).toBe("price");
    });

    it("should create numerical analysis for decimal types", () => {
      const dataFrame = createDataFrame([{ name: "amount", type: "decimal" }]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      expect(encoding.y).toBe("amount");
    });

    it("should create numerical analysis for double types", () => {
      const dataFrame = createDataFrame([{ name: "value", type: "double" }]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      expect(encoding.y).toBe("value");
    });

    it("should create temporal analysis for date types", () => {
      const dataFrame = createDataFrame([{ name: "date", type: "date" }]);

      const encoding = autoSelectEncoding("line", dataFrame);

      // Should select date column for X-axis in line chart
      expect(encoding.x).toBe("date");
    });

    it("should create temporal analysis for datetime types", () => {
      const dataFrame = createDataFrame([{ name: "timestamp", type: "datetime" }]);

      const encoding = autoSelectEncoding("line", dataFrame);

      expect(encoding.x).toBe("timestamp");
    });

    it("should create temporal analysis for timestamp types", () => {
      const dataFrame = createDataFrame([
        { name: "created_at", type: "timestamp" },
      ]);

      const encoding = autoSelectEncoding("areaY", dataFrame);

      expect(encoding.x).toBe("created_at");
    });

    it("should create temporal analysis for time types", () => {
      const dataFrame = createDataFrame([{ name: "time", type: "time" }]);

      const encoding = autoSelectEncoding("line", dataFrame);

      expect(encoding.x).toBe("time");
    });

    it("should create boolean analysis for boolean types", () => {
      const dataFrame = createDataFrame([{ name: "is_active", type: "boolean" }]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      // Should select boolean column for X-axis (categorical)
      expect(encoding.x).toBe("is_active");
    });

    it("should create categorical analysis for string types", () => {
      const dataFrame = createDataFrame([{ name: "category", type: "string" }]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      expect(encoding.x).toBe("category");
    });

    it("should handle mixed case type strings", () => {
      const dataFrame = createDataFrame([
        { name: "Amount", type: "NUMBER" },
        { name: "Date", type: "DATETIME" },
      ]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      expect(encoding.y).toBe("Amount");
    });
  });

  // ============================================================================
  // barY Chart Type
  // ============================================================================

  describe("barY Chart Type", () => {
    it("should select categorical column for X and numerical for Y", () => {
      const dataFrame = createDataFrame([
        { name: "product", type: "string" },
        { name: "sales", type: "number" },
      ]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      expect(encoding.x).toBe("product");
      expect(encoding.y).toBe("sales");
    });

    it("should prefer metrics over regular fields for Y-axis", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "raw_value", type: "number" },
        { name: "total_sales", type: "number" },
      ]);
      const insight = createInsight(["total_sales"]);

      const encoding = autoSelectEncoding("barY", dataFrame, undefined, {}, insight);

      expect(encoding.x).toBe("category");
      expect(encoding.y).toBe("total_sales"); // Metric preferred over raw_value
    });

    it("should use regular numerical field if no metrics available", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "value", type: "number" },
      ]);
      const insight = createInsight([]); // No metrics

      const encoding = autoSelectEncoding("barY", dataFrame, undefined, {}, insight);

      expect(encoding.y).toBe("value");
    });

    it("should preserve valid X encoding", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "region", type: "string" },
        { name: "sales", type: "number" },
      ]);
      const currentEncoding = { x: "region" };

      const encoding = autoSelectEncoding("barY", dataFrame, undefined, currentEncoding);

      expect(encoding.x).toBe("region"); // Preserved
      expect(encoding.y).toBe("sales");
    });

    it("should replace invalid X encoding", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "sales", type: "number" },
      ]);
      const currentEncoding = { x: "nonexistent" };

      const encoding = autoSelectEncoding("barY", dataFrame, undefined, currentEncoding);

      expect(encoding.x).toBe("category"); // Replaced with valid column
    });

    it("should preserve valid numerical Y encoding", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "revenue", type: "number" },
        { name: "profit", type: "number" },
      ]);
      const currentEncoding = { y: "profit" };

      const encoding = autoSelectEncoding("barY", dataFrame, undefined, currentEncoding);

      expect(encoding.y).toBe("profit"); // Preserved
    });

    it("should replace non-numerical Y encoding", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "sales", type: "number" },
      ]);
      const currentEncoding = { y: "category" }; // Invalid: not numerical

      const encoding = autoSelectEncoding("barY", dataFrame, undefined, currentEncoding);

      expect(encoding.y).toBe("sales"); // Replaced with numerical column
    });

    it("should fall back to first non-numerical column for X if no categorical", () => {
      const dataFrame = createDataFrame([
        { name: "value1", type: "number" },
        { name: "value2", type: "number" },
      ]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      // Should fall back to first column as last resort
      expect(encoding.x).toBe("value1");
    });

    it("should handle empty dataframe", () => {
      const dataFrame = createDataFrame([]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      expect(encoding.x).toBeUndefined();
      expect(encoding.y).toBeUndefined();
    });
  });

  // ============================================================================
  // line Chart Type
  // ============================================================================

  describe("line Chart Type", () => {
    it("should prefer temporal column for X-axis", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "date", type: "date" },
        { name: "value", type: "number" },
      ]);

      const encoding = autoSelectEncoding("line", dataFrame);

      expect(encoding.x).toBe("date"); // Temporal preferred for line
      expect(encoding.y).toBe("value");
    });

    it("should fall back to categorical for X if no temporal", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "value", type: "number" },
      ]);

      const encoding = autoSelectEncoding("line", dataFrame);

      expect(encoding.x).toBe("category"); // Fallback to categorical
      expect(encoding.y).toBe("value");
    });

    it("should preserve valid temporal X encoding", () => {
      const dataFrame = createDataFrame([
        { name: "created_at", type: "timestamp" },
        { name: "updated_at", type: "timestamp" },
        { name: "value", type: "number" },
      ]);
      const currentEncoding = { x: "updated_at" };

      const encoding = autoSelectEncoding("line", dataFrame, undefined, currentEncoding);

      expect(encoding.x).toBe("updated_at"); // Preserved
    });

    it("should select metric for Y-axis when available", () => {
      const dataFrame = createDataFrame([
        { name: "date", type: "date" },
        { name: "raw_count", type: "number" },
        { name: "total_count", type: "number" },
      ]);
      const insight = createInsight(["total_count"]);

      const encoding = autoSelectEncoding("line", dataFrame, undefined, {}, insight);

      expect(encoding.y).toBe("total_count"); // Metric preferred
    });
  });

  // ============================================================================
  // areaY Chart Type
  // ============================================================================

  describe("areaY Chart Type", () => {
    it("should prefer temporal column for X-axis", () => {
      const dataFrame = createDataFrame([
        { name: "date", type: "date" },
        { name: "revenue", type: "number" },
      ]);

      const encoding = autoSelectEncoding("areaY", dataFrame);

      expect(encoding.x).toBe("date"); // Temporal preferred for area
      expect(encoding.y).toBe("revenue");
    });

    it("should handle multiple temporal columns", () => {
      const dataFrame = createDataFrame([
        { name: "created_at", type: "timestamp" },
        { name: "updated_at", type: "timestamp" },
        { name: "value", type: "number" },
      ]);

      const encoding = autoSelectEncoding("areaY", dataFrame);

      // Should pick first temporal column
      expect(encoding.x).toBe("created_at");
      expect(encoding.y).toBe("value");
    });

    it("should prefer metrics for Y-axis", () => {
      const dataFrame = createDataFrame([
        { name: "date", type: "date" },
        { name: "sum_revenue", type: "number" },
        { name: "raw_amount", type: "number" },
      ]);
      const insight = createInsight(["sum_revenue"]);

      const encoding = autoSelectEncoding("areaY", dataFrame, undefined, {}, insight);

      expect(encoding.y).toBe("sum_revenue");
    });
  });

  // ============================================================================
  // dot (Scatter) Chart Type
  // ============================================================================

  describe("dot Chart Type", () => {
    it("should select two different numerical columns", () => {
      const dataFrame = createDataFrame([
        { name: "height", type: "number" },
        { name: "weight", type: "number" },
      ]);

      const encoding = autoSelectEncoding("dot", dataFrame);

      expect(encoding.x).toBe("height");
      expect(encoding.y).toBe("weight");
    });

    it("should preserve valid numerical X encoding", () => {
      const dataFrame = createDataFrame([
        { name: "age", type: "number" },
        { name: "income", type: "number" },
        { name: "score", type: "number" },
      ]);
      const currentEncoding = { x: "income" };

      const encoding = autoSelectEncoding("dot", dataFrame, undefined, currentEncoding);

      expect(encoding.x).toBe("income"); // Preserved
      expect(encoding.y).toBe("age"); // Different from X
    });

    it("should replace non-numerical X encoding", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "value1", type: "number" },
        { name: "value2", type: "number" },
      ]);
      const currentEncoding = { x: "category" }; // Invalid: not numerical

      const encoding = autoSelectEncoding("dot", dataFrame, undefined, currentEncoding);

      expect(encoding.x).toBe("value1"); // Replaced with numerical
      expect(encoding.y).toBe("value2");
    });

    it("should preserve valid numerical Y encoding", () => {
      const dataFrame = createDataFrame([
        { name: "x_value", type: "number" },
        { name: "y_value", type: "number" },
        { name: "z_value", type: "number" },
      ]);
      const currentEncoding = { y: "z_value" };

      const encoding = autoSelectEncoding("dot", dataFrame, undefined, currentEncoding);

      expect(encoding.y).toBe("z_value"); // Preserved
    });

    it("should select different column for Y than X", () => {
      const dataFrame = createDataFrame([
        { name: "metric1", type: "number" },
        { name: "metric2", type: "number" },
        { name: "metric3", type: "number" },
      ]);

      const encoding = autoSelectEncoding("dot", dataFrame);

      expect(encoding.x).toBe("metric1");
      expect(encoding.y).toBe("metric2"); // Different from X
    });

    it("should handle only one numerical column", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "value", type: "number" },
      ]);

      const encoding = autoSelectEncoding("dot", dataFrame);

      expect(encoding.x).toBe("value");
      expect(encoding.y).toBe("value"); // Same column as fallback
    });

    it("should handle no numerical columns", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "label", type: "string" },
      ]);

      const encoding = autoSelectEncoding("dot", dataFrame);

      expect(encoding.x).toBeUndefined();
      expect(encoding.y).toBeUndefined();
    });

    it("should ignore non-measure semantics for Y when possible", () => {
      // Note: The current implementation creates analysis from DataFrame columns
      // and doesn't directly check semantic types like "identifier" from the analysis.
      // This test verifies the fallback behavior when selecting different columns.
      const dataFrame = createDataFrame([
        { name: "id", type: "number" },
        { name: "value", type: "number" },
      ]);

      const encoding = autoSelectEncoding("dot", dataFrame);

      // Should select different columns for X and Y
      expect(encoding.x).toBe("id");
      expect(encoding.y).toBe("value");
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge Cases", () => {
    it("should handle dataframe without columns array", () => {
      const dataFrame: DataFrameData = {
        rows: [],
        // columns is optional
      };

      const encoding = autoSelectEncoding("barY", dataFrame);

      expect(encoding.x).toBeUndefined();
      expect(encoding.y).toBeUndefined();
    });

    it("should handle empty columns array", () => {
      const dataFrame = createDataFrame([]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      expect(encoding.x).toBeUndefined();
      expect(encoding.y).toBeUndefined();
    });

    it("should preserve additional encoding properties", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "value", type: "number" },
      ]);
      const currentEncoding = {
        x: "category",
        y: "value",
        color: "region",
        size: "population",
      };

      const encoding = autoSelectEncoding("barY", dataFrame, undefined, currentEncoding);

      // Should preserve x, y and additional properties
      expect(encoding.x).toBe("category");
      expect(encoding.y).toBe("value");
      expect(encoding.color).toBe("region");
      expect(encoding.size).toBe("population");
    });

    it("should handle unknown column types as categorical", () => {
      const dataFrame = createDataFrame([
        { name: "weird_column", type: "custom_type" },
        { name: "value", type: "number" },
      ]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      // Unknown types should be treated as string/categorical
      expect(encoding.x).toBe("weird_column");
      expect(encoding.y).toBe("value");
    });

    it("should handle insight without metrics", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "value", type: "number" },
      ]);
      const insight = createInsight([]);

      const encoding = autoSelectEncoding("barY", dataFrame, undefined, {}, insight);

      // Should still work without metrics
      expect(encoding.x).toBe("category");
      expect(encoding.y).toBe("value");
    });

    it("should handle undefined insight", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "value", type: "number" },
      ]);

      const encoding = autoSelectEncoding("barY", dataFrame, undefined, {}, undefined);

      // Should work without insight
      expect(encoding.x).toBe("category");
      expect(encoding.y).toBe("value");
    });

    it("should handle multiple metrics", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "sum_sales", type: "number" },
        { name: "avg_price", type: "number" },
        { name: "count_orders", type: "number" },
      ]);
      const insight = createInsight(["sum_sales", "avg_price", "count_orders"]);

      const encoding = autoSelectEncoding("barY", dataFrame, undefined, {}, insight);

      // Should select first metric for Y
      expect(encoding.y).toBe("sum_sales");
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("Integration Tests", () => {
    it("should handle complete workflow for bar chart", () => {
      const dataFrame = createDataFrame([
        { name: "product", type: "string" },
        { name: "category", type: "string" },
        { name: "sales", type: "number" },
        { name: "quantity", type: "number" },
      ]);

      // Initial selection
      const encoding1 = autoSelectEncoding("barY", dataFrame);
      expect(encoding1.x).toBe("product");
      expect(encoding1.y).toBe("sales");

      // User changes X axis
      const encoding2 = autoSelectEncoding("barY", dataFrame, undefined, {
        x: "category",
        y: "sales",
      });
      expect(encoding2.x).toBe("category"); // Preserved
      expect(encoding2.y).toBe("sales"); // Preserved
    });

    it("should handle chart type transition from bar to scatter", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "sales", type: "number" },
        { name: "profit", type: "number" },
      ]);

      // Start with bar chart
      const barEncoding = autoSelectEncoding("barY", dataFrame);
      expect(barEncoding.x).toBe("category");
      expect(barEncoding.y).toBe("sales");

      // Switch to scatter - should select two numerical columns
      const scatterEncoding = autoSelectEncoding("dot", dataFrame, undefined, barEncoding);
      expect(scatterEncoding.x).toBe("sales");
      expect(scatterEncoding.y).toBe("profit");
    });

    it("should handle chart type transition from scatter to line", () => {
      const dataFrame = createDataFrame([
        { name: "date", type: "date" },
        { name: "value1", type: "number" },
        { name: "value2", type: "number" },
      ]);

      // Start with scatter
      const scatterEncoding = autoSelectEncoding("dot", dataFrame);
      expect(scatterEncoding.x).toBe("value1");
      expect(scatterEncoding.y).toBe("value2");

      // Switch to line - should prefer temporal for X
      const lineEncoding = autoSelectEncoding("line", dataFrame, undefined, scatterEncoding);
      expect(lineEncoding.x).toBe("date"); // Temporal preferred
      expect(lineEncoding.y).toBe("value2"); // Preserved if numerical
    });

    it("should handle complex dataframe with all column types", () => {
      const dataFrame = createDataFrame([
        { name: "id", type: "string" },
        { name: "name", type: "string" },
        { name: "active", type: "boolean" },
        { name: "created_at", type: "timestamp" },
        { name: "count", type: "integer" },
        { name: "revenue", type: "number" },
        { name: "score", type: "float" },
      ]);
      const insight = createInsight(["revenue"]);

      const encoding = autoSelectEncoding("barY", dataFrame, undefined, {}, insight);

      // Should select first categorical for X and metric for Y
      expect(encoding.x).toBe("id");
      expect(encoding.y).toBe("revenue"); // Metric preferred
    });
  });

  // ============================================================================
  // Type Safety
  // ============================================================================

  describe("Type Safety", () => {
    it("should always return an object", () => {
      const dataFrame = createDataFrame([]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      expect(encoding).toBeDefined();
      expect(typeof encoding).toBe("object");
    });

    it("should not mutate input currentEncoding", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "value", type: "number" },
      ]);
      const currentEncoding = { x: "category", y: "value" };
      const originalEncoding = { ...currentEncoding };

      autoSelectEncoding("barY", dataFrame, undefined, currentEncoding);

      expect(currentEncoding).toEqual(originalEncoding);
    });

    it("should handle all supported chart types", () => {
      const dataFrame = createDataFrame([
        { name: "date", type: "date" },
        { name: "category", type: "string" },
        { name: "value", type: "number" },
      ]);

      // Should not throw for any supported chart type
      expect(() => autoSelectEncoding("barY", dataFrame)).not.toThrow();
      expect(() => autoSelectEncoding("line", dataFrame)).not.toThrow();
      expect(() => autoSelectEncoding("areaY", dataFrame)).not.toThrow();
      expect(() => autoSelectEncoding("dot", dataFrame)).not.toThrow();
    });

    it("should return encoding with correct property types", () => {
      const dataFrame = createDataFrame([
        { name: "category", type: "string" },
        { name: "value", type: "number" },
      ]);

      const encoding = autoSelectEncoding("barY", dataFrame);

      if (encoding.x !== undefined) {
        expect(typeof encoding.x).toBe("string");
      }
      if (encoding.y !== undefined) {
        expect(typeof encoding.y).toBe("string");
      }
    });
  });
});
