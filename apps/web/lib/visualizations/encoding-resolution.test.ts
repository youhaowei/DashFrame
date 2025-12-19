/**
 * Unit tests for encoding resolution helpers
 */
import { describe, it, expect } from "vitest";
import {
  resolveToSql,
  resolveForAnalysis,
  resolveEncodingToSql,
} from "@dashframe/engine";
import { fieldEncoding, metricEncoding } from "@dashframe/types";
import type { Field, InsightMetric, UUID } from "@dashframe/types";

describe("encoding-resolution", () => {
  // Test fixtures
  const tableId = "table-1" as UUID;
  const mockFields: Field[] = [
    {
      id: "field-1" as UUID,
      tableId,
      name: "Category",
      columnName: "category",
      type: "string",
    },
    {
      id: "field-2" as UUID,
      tableId,
      name: "Revenue",
      columnName: "revenue",
      type: "number",
    },
    {
      id: "field-3" as UUID,
      tableId,
      name: "Created Date",
      columnName: "created_at",
      type: "date",
    },
  ];

  const mockMetrics: InsightMetric[] = [
    {
      id: "metric-1" as UUID,
      name: "Total Revenue",
      sourceTable: "table-1" as UUID,
      columnName: "revenue",
      aggregation: "sum",
    },
    {
      id: "metric-2" as UUID,
      name: "Order Count",
      sourceTable: "table-1" as UUID,
      columnName: undefined, // count(*)
      aggregation: "count",
    },
    {
      id: "metric-3" as UUID,
      name: "Unique Categories",
      sourceTable: "table-1" as UUID,
      columnName: "category",
      aggregation: "count_distinct",
    },
  ];

  const context = {
    fields: mockFields,
    metrics: mockMetrics,
  };

  describe("resolveToSql", () => {
    it("should resolve field encoding to column name", () => {
      const result = resolveToSql(fieldEncoding("field-1" as UUID), context);
      expect(result).toBe("category");
    });

    it("should resolve metric encoding to SQL expression", () => {
      const result = resolveToSql(metricEncoding("metric-1" as UUID), context);
      expect(result).toBe("sum(revenue)");
    });

    it("should resolve count(*) metric correctly", () => {
      const result = resolveToSql(metricEncoding("metric-2" as UUID), context);
      expect(result).toBe("count(*)");
    });

    it("should resolve count_distinct metric correctly", () => {
      const result = resolveToSql(metricEncoding("metric-3" as UUID), context);
      expect(result).toBe("count_distinct(category)");
    });

    it("should return undefined for undefined input", () => {
      const result = resolveToSql(undefined, context);
      expect(result).toBeUndefined();
    });

    it("should return undefined for invalid encoding format", () => {
      const result = resolveToSql("sum(revenue)", context);
      expect(result).toBeUndefined();
    });

    it("should return undefined for non-existent field ID", () => {
      const result = resolveToSql(
        fieldEncoding("non-existent" as UUID),
        context,
      );
      expect(result).toBeUndefined();
    });

    it("should return undefined for non-existent metric ID", () => {
      const result = resolveToSql(
        metricEncoding("non-existent" as UUID),
        context,
      );
      expect(result).toBeUndefined();
    });
  });

  describe("resolveForAnalysis", () => {
    it("should resolve field encoding with columnName and isMetric=false", () => {
      const result = resolveForAnalysis(
        fieldEncoding("field-1" as UUID),
        context,
      );
      expect(result).toEqual({
        columnName: "category",
        isMetric: false,
        valid: true,
      });
    });

    it("should resolve metric encoding with columnName and isMetric=true", () => {
      const result = resolveForAnalysis(
        metricEncoding("metric-1" as UUID),
        context,
      );
      expect(result).toEqual({
        columnName: "revenue",
        isMetric: true,
        sqlExpression: "sum(revenue)",
        valid: true,
      });
    });

    it("should handle count(*) metric with undefined columnName", () => {
      const result = resolveForAnalysis(
        metricEncoding("metric-2" as UUID),
        context,
      );
      expect(result).toEqual({
        columnName: undefined,
        isMetric: true,
        sqlExpression: "count(*)",
        valid: true,
      });
    });

    it("should return valid=false for invalid encoding format", () => {
      const result = resolveForAnalysis("sum(revenue)", context);
      expect(result.valid).toBe(false);
      expect(result.isMetric).toBe(false);
    });

    it("should return valid=false for undefined input", () => {
      const result = resolveForAnalysis(undefined, context);
      expect(result.valid).toBe(false);
    });
  });

  describe("resolveEncodingToSql", () => {
    it("should resolve all encoding channels", () => {
      const encoding = {
        x: fieldEncoding("field-1" as UUID),
        y: metricEncoding("metric-1" as UUID),
        color: fieldEncoding("field-3" as UUID),
      };

      const result = resolveEncodingToSql(encoding, context);

      expect(result.x).toBe("category");
      expect(result.y).toBe("sum(revenue)");
      expect(result.color).toBe("created_at");
    });

    it("should handle undefined channels", () => {
      const encoding = {
        x: fieldEncoding("field-1" as UUID),
        // y is undefined
      };

      const result = resolveEncodingToSql(encoding, context);

      expect(result.x).toBe("category");
      expect(result.y).toBeUndefined();
    });

    it("should only resolve x, y, color, size channels (not axis types)", () => {
      const encoding = {
        x: fieldEncoding("field-1" as UUID),
        y: metricEncoding("metric-1" as UUID),
        xType: "nominal" as const,
        yType: "quantitative" as const,
      };

      const result = resolveEncodingToSql(encoding, context);

      // resolveEncodingToSql only resolves data channels, not axis types
      // Axis types should be preserved separately by the caller
      expect(result.x).toBe("category");
      expect(result.y).toBe("sum(revenue)");
      expect(Object.keys(result).sort()).toEqual(["color", "size", "x", "y"]);
    });
  });
});
