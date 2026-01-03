/**
 * Unit tests for encoding-enforcer module
 *
 * Tests cover:
 * - Channel validation by chart type (barY, barX, line, areaY, dot)
 * - Encoding format validation (field: vs metric: prefixes)
 * - Semantic blocking (identifiers, references, etc.)
 * - Column suitability for specific channels
 * - Encoding validation and error messages
 * - Axis swapping rules and chart type transitions
 * - Axis semantic labels for different chart types
 */
import { describe, expect, it } from "vitest";
import type {
  ColumnAnalysis,
  CompiledInsight,
  Field,
  InsightMetric,
  NumberAnalysis,
  StringAnalysis,
  DateAnalysis,
  BooleanAnalysis,
  UUID,
} from "@dashframe/types";
import {
  getValidColumnsForChannel,
  isColumnValidForChannel,
  validateEncoding,
  isSwapAllowed,
  getSwappedChartType,
  getAxisSemanticLabel,
} from "./encoding-enforcer";

describe("encoding-enforcer", () => {
  // ============================================================================
  // Mock Data Helpers
  // ============================================================================

  const createStringColumn = (
    overrides: Partial<StringAnalysis> = {},
  ): StringAnalysis => ({
    columnName: "field_cat123",
    dataType: "string",
    semantic: "categorical",
    cardinality: 5,
    uniqueness: 0.5,
    nullCount: 0,
    sampleValues: ["A", "B", "C", "D", "E"],
    fieldId: "cat123",
    ...overrides,
  });

  const createNumberColumn = (
    overrides: Partial<NumberAnalysis> = {},
  ): NumberAnalysis => ({
    columnName: "field_num456",
    dataType: "number",
    semantic: "numerical",
    cardinality: 100,
    uniqueness: 0.9,
    nullCount: 0,
    sampleValues: [10, 20, 30, 40, 50],
    min: 0,
    max: 100,
    stdDev: 25,
    zeroCount: 0,
    fieldId: "num456",
    ...overrides,
  });

  const createDateColumn = (
    overrides: Partial<DateAnalysis> = {},
  ): DateAnalysis => {
    const now = Date.now();
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
    return {
      columnName: "field_date789",
      dataType: "date",
      semantic: "temporal",
      cardinality: 365,
      uniqueness: 0.8,
      nullCount: 0,
      sampleValues: [oneYearAgo, now],
      minDate: oneYearAgo,
      maxDate: now,
      fieldId: "date789",
      ...overrides,
    };
  };

  const createBooleanColumn = (
    overrides: Partial<BooleanAnalysis> = {},
  ): BooleanAnalysis => ({
    columnName: "field_bool999",
    dataType: "boolean",
    semantic: "boolean",
    cardinality: 2,
    uniqueness: 0.5,
    nullCount: 0,
    sampleValues: [true, false],
    fieldId: "bool999",
    ...overrides,
  });

  const createField = (overrides: Partial<Field> = {}): Field => ({
    id: "field123" as UUID,
    name: "Test Field",
    columnName: "test_field",
    dataTableId: "table123" as UUID,
    sourceColumn: "test_field",
    dataType: "string",
    createdAt: Date.now(),
    ...overrides,
  });

  const createMetric = (
    overrides: Partial<InsightMetric> = {},
  ): InsightMetric => ({
    id: "metric123" as UUID,
    name: "Total Revenue",
    aggregation: "sum",
    fieldId: "field123" as UUID,
    ...overrides,
  });

  const createCompiledInsight = (
    overrides: Partial<CompiledInsight> = {},
  ): CompiledInsight => ({
    dimensions: [],
    metrics: [],
    ...overrides,
  });

  // ============================================================================
  // getValidColumnsForChannel()
  // ============================================================================

  describe("getValidColumnsForChannel()", () => {
    describe("barY (vertical bar chart)", () => {
      it("should return categorical columns for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_region",
            semantic: "categorical",
          }),
          createNumberColumn({ columnName: "field_revenue" }),
        ];

        const result = getValidColumnsForChannel("x", "barY", analysis);

        expect(result).toContain("field_region");
        expect(result).not.toContain("field_revenue");
      });

      it("should return temporal columns for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date" }),
          createNumberColumn({ columnName: "field_value" }),
        ];

        const result = getValidColumnsForChannel("x", "barY", analysis);

        expect(result).toContain("field_date");
        expect(result).not.toContain("field_value");
      });

      it("should return boolean columns for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createBooleanColumn({ columnName: "field_active" }),
          createNumberColumn({ columnName: "field_count" }),
        ];

        const result = getValidColumnsForChannel("x", "barY", analysis);

        expect(result).toContain("field_active");
        expect(result).not.toContain("field_count");
      });

      it("should exclude identifier columns from X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_user_id",
            semantic: "identifier",
          }),
          createStringColumn({ columnName: "field_region" }),
        ];

        const result = getValidColumnsForChannel("x", "barY", analysis);

        expect(result).not.toContain("field_user_id");
        expect(result).toContain("field_region");
      });

      it("should exclude columns with ID-like names from X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_customer_id" }),
          createStringColumn({ columnName: "field_region" }),
        ];

        const result = getValidColumnsForChannel("x", "barY", analysis);

        expect(result).not.toContain("field_customer_id");
        expect(result).toContain("field_region");
      });

      it("should return metrics for Y axis", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_region" }),
          createNumberColumn({ columnName: "field_revenue" }),
        ];
        const compiled = createCompiledInsight({
          metrics: [
            createMetric({ id: "m1" as UUID, name: "total_revenue" }),
            createMetric({ id: "m2" as UUID, name: "total_count" }),
          ],
        });

        const result = getValidColumnsForChannel("y", "barY", analysis, compiled);

        expect(result).toContain("total_revenue");
        expect(result).toContain("total_count");
        expect(result).not.toContain("field_region");
      });

      it("should not return columns for Y axis (only metrics allowed)", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_revenue" }),
        ];

        const result = getValidColumnsForChannel("y", "barY", analysis);

        expect(result).toEqual([]);
      });
    });

    describe("barX (horizontal bar chart)", () => {
      it("should return metrics for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_region" }),
        ];
        const compiled = createCompiledInsight({
          metrics: [createMetric({ id: "m1" as UUID, name: "total_revenue" })],
        });

        const result = getValidColumnsForChannel("x", "barX", analysis, compiled);

        expect(result).toContain("total_revenue");
        expect(result).not.toContain("field_region");
      });

      it("should return categorical columns for Y axis", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_region" }),
          createNumberColumn({ columnName: "field_revenue" }),
        ];

        const result = getValidColumnsForChannel("y", "barX", analysis);

        expect(result).toContain("field_region");
        expect(result).not.toContain("field_revenue");
      });

      it("should exclude identifier columns from Y axis", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_user_id",
            semantic: "identifier",
          }),
          createStringColumn({ columnName: "field_category" }),
        ];

        const result = getValidColumnsForChannel("y", "barX", analysis);

        expect(result).not.toContain("field_user_id");
        expect(result).toContain("field_category");
      });
    });

    describe("line chart", () => {
      it("should return temporal columns for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date" }),
          createStringColumn({ columnName: "field_category" }),
        ];

        const result = getValidColumnsForChannel("x", "line", analysis);

        expect(result).toContain("field_date");
        expect(result).not.toContain("field_category");
      });

      it("should return numerical columns for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_value" }),
          createStringColumn({ columnName: "field_category" }),
        ];

        const result = getValidColumnsForChannel("x", "line", analysis);

        expect(result).toContain("field_value");
        expect(result).not.toContain("field_category");
      });

      it("should exclude categorical columns from X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_category" }),
          createDateColumn({ columnName: "field_date" }),
        ];

        const result = getValidColumnsForChannel("x", "line", analysis);

        expect(result).not.toContain("field_category");
        expect(result).toContain("field_date");
      });

      it("should return metrics for Y axis", () => {
        const analysis: ColumnAnalysis[] = [];
        const compiled = createCompiledInsight({
          metrics: [createMetric({ id: "m1" as UUID, name: "total_sales" })],
        });

        const result = getValidColumnsForChannel("y", "line", analysis, compiled);

        expect(result).toContain("total_sales");
      });

      it("should not return columns for Y axis (only metrics allowed)", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_value" }),
        ];

        const result = getValidColumnsForChannel("y", "line", analysis);

        expect(result).toEqual([]);
      });
    });

    describe("areaY chart", () => {
      it("should return temporal/numerical columns for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date" }),
          createNumberColumn({ columnName: "field_value" }),
          createStringColumn({ columnName: "field_category" }),
        ];

        const result = getValidColumnsForChannel("x", "areaY", analysis);

        expect(result).toContain("field_date");
        expect(result).toContain("field_value");
        expect(result).not.toContain("field_category");
      });

      it("should return metrics for Y axis", () => {
        const analysis: ColumnAnalysis[] = [];
        const compiled = createCompiledInsight({
          metrics: [createMetric({ id: "m1" as UUID, name: "total_amount" })],
        });

        const result = getValidColumnsForChannel(
          "y",
          "areaY",
          analysis,
          compiled,
        );

        expect(result).toContain("total_amount");
      });
    });

    describe("dot (scatter plot)", () => {
      it("should return continuous columns for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_x" }),
          createDateColumn({ columnName: "field_date" }),
          createStringColumn({ columnName: "field_category" }),
        ];

        const result = getValidColumnsForChannel("x", "dot", analysis);

        expect(result).toContain("field_x");
        expect(result).toContain("field_date");
        expect(result).not.toContain("field_category");
      });

      it("should return continuous columns for Y axis", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_y" }),
          createDateColumn({ columnName: "field_date" }),
          createStringColumn({ columnName: "field_category" }),
        ];

        const result = getValidColumnsForChannel("y", "dot", analysis);

        expect(result).toContain("field_y");
        expect(result).toContain("field_date");
        expect(result).not.toContain("field_category");
      });

      it("should return metrics for both axes", () => {
        const analysis: ColumnAnalysis[] = [];
        const compiled = createCompiledInsight({
          metrics: [
            createMetric({ id: "m1" as UUID, name: "metric_x" }),
            createMetric({ id: "m2" as UUID, name: "metric_y" }),
          ],
        });

        const resultX = getValidColumnsForChannel(
          "x",
          "dot",
          analysis,
          compiled,
        );
        const resultY = getValidColumnsForChannel(
          "y",
          "dot",
          analysis,
          compiled,
        );

        expect(resultX).toContain("metric_x");
        expect(resultX).toContain("metric_y");
        expect(resultY).toContain("metric_x");
        expect(resultY).toContain("metric_y");
      });

      it("should exclude identifier columns from both axes", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_order_id",
            semantic: "identifier",
          }),
          createNumberColumn({ columnName: "field_value" }),
        ];

        const resultX = getValidColumnsForChannel("x", "dot", analysis);
        const resultY = getValidColumnsForChannel("y", "dot", analysis);

        expect(resultX).not.toContain("field_order_id");
        expect(resultY).not.toContain("field_order_id");
      });
    });

    describe("color and size channels", () => {
      it("should return all columns for color channel", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_region" }),
          createNumberColumn({ columnName: "field_value" }),
          createDateColumn({ columnName: "field_date" }),
        ];

        const result = getValidColumnsForChannel("color", "barY", analysis);

        expect(result).toContain("field_region");
        expect(result).toContain("field_value");
        expect(result).toContain("field_date");
      });

      it("should return all columns for size channel", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_category" }),
          createNumberColumn({ columnName: "field_amount" }),
        ];

        const result = getValidColumnsForChannel("size", "dot", analysis);

        expect(result).toContain("field_category");
        expect(result).toContain("field_amount");
      });
    });

    describe("edge cases", () => {
      it("should return empty array when no columns match", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_category" }),
        ];

        const result = getValidColumnsForChannel("x", "line", analysis);

        expect(result).toEqual([]);
      });

      it("should handle empty analysis array", () => {
        const result = getValidColumnsForChannel("x", "barY", []);

        expect(result).toEqual([]);
      });

      it("should handle missing compiled insight", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_region" }),
        ];

        const result = getValidColumnsForChannel("y", "barY", analysis);

        expect(result).toEqual([]);
      });
    });
  });

  // ============================================================================
  // isColumnValidForChannel()
  // ============================================================================

  describe("isColumnValidForChannel()", () => {
    describe("barY chart validation", () => {
      it("should accept categorical field for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_cat123" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "cat123" as UUID, columnName: "field_cat123" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:cat123",
          "x",
          "barY",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });

      it("should accept temporal field for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date789" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "date789" as UUID, columnName: "field_date789" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:date789",
          "x",
          "barY",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });

      it("should reject metric for X axis", () => {
        const analysis: ColumnAnalysis[] = [];
        const compiled = createCompiledInsight({
          metrics: [createMetric({ id: "m1" as UUID })],
        });

        const result = isColumnValidForChannel(
          "metric:m1",
          "x",
          "barY",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(false);
        expect(result.reason).toContain("dimension");
      });

      it("should reject numerical field for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_num456" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "num456" as UUID, columnName: "field_num456" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:num456",
          "x",
          "barY",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(false);
        expect(result.reason).toContain("category or date");
      });

      it("should reject identifier field for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_user_id",
            semantic: "identifier",
          }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "user_id" as UUID, columnName: "field_user_id" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:user_id",
          "x",
          "barY",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(false);
        expect(result.reason).toContain("Identifiers");
      });

      it("should accept metric for Y axis", () => {
        const analysis: ColumnAnalysis[] = [];
        const compiled = createCompiledInsight({
          metrics: [createMetric({ id: "m1" as UUID })],
        });

        const result = isColumnValidForChannel(
          "metric:m1",
          "y",
          "barY",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });

      it("should reject field for Y axis", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_num456" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "num456" as UUID, columnName: "field_num456" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:num456",
          "y",
          "barY",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(false);
        expect(result.reason).toContain("metric");
      });

      it("should reject invalid encoding format", () => {
        const analysis: ColumnAnalysis[] = [];
        const compiled = createCompiledInsight();

        const result = isColumnValidForChannel(
          "invalid_format",
          "x",
          "barY",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(false);
        expect(result.reason).toContain("Invalid encoding format");
      });

      it("should reject undefined encoding", () => {
        const analysis: ColumnAnalysis[] = [];
        const compiled = createCompiledInsight();

        const result = isColumnValidForChannel(
          "",
          "x",
          "barY",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(false);
      });
    });

    describe("barX chart validation", () => {
      it("should accept metric for X axis", () => {
        const analysis: ColumnAnalysis[] = [];
        const compiled = createCompiledInsight({
          metrics: [createMetric({ id: "m1" as UUID })],
        });

        const result = isColumnValidForChannel(
          "metric:m1",
          "x",
          "barX",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });

      it("should reject field for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_num456" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "num456" as UUID, columnName: "field_num456" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:num456",
          "x",
          "barX",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(false);
        expect(result.reason).toContain("metric");
      });

      it("should accept categorical field for Y axis", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_cat123" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "cat123" as UUID, columnName: "field_cat123" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:cat123",
          "y",
          "barX",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });

      it("should reject metric for Y axis", () => {
        const analysis: ColumnAnalysis[] = [];
        const compiled = createCompiledInsight({
          metrics: [createMetric({ id: "m1" as UUID })],
        });

        const result = isColumnValidForChannel(
          "metric:m1",
          "y",
          "barX",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(false);
        expect(result.reason).toContain("dimension");
      });
    });

    describe("line chart validation", () => {
      it("should accept temporal field for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date789" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "date789" as UUID, columnName: "field_date789" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:date789",
          "x",
          "line",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });

      it("should accept numerical field for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_num456" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "num456" as UUID, columnName: "field_num456" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:num456",
          "x",
          "line",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });

      it("should reject categorical field for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_cat123" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "cat123" as UUID, columnName: "field_cat123" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:cat123",
          "x",
          "line",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(false);
        expect(result.reason).toContain("continuous");
      });

      it("should reject metric for X axis", () => {
        const analysis: ColumnAnalysis[] = [];
        const compiled = createCompiledInsight({
          metrics: [createMetric({ id: "m1" as UUID })],
        });

        const result = isColumnValidForChannel(
          "metric:m1",
          "x",
          "line",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(false);
        expect(result.reason).toContain("dimension");
      });

      it("should accept metric for Y axis", () => {
        const analysis: ColumnAnalysis[] = [];
        const compiled = createCompiledInsight({
          metrics: [createMetric({ id: "m1" as UUID })],
        });

        const result = isColumnValidForChannel(
          "metric:m1",
          "y",
          "line",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });

      it("should reject field for Y axis", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_num456" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "num456" as UUID, columnName: "field_num456" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:num456",
          "y",
          "line",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(false);
        expect(result.reason).toContain("metric");
      });
    });

    describe("areaY chart validation", () => {
      it("should accept temporal field for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date789" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "date789" as UUID, columnName: "field_date789" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:date789",
          "x",
          "areaY",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });

      it("should accept metric for Y axis", () => {
        const analysis: ColumnAnalysis[] = [];
        const compiled = createCompiledInsight({
          metrics: [createMetric({ id: "m1" as UUID })],
        });

        const result = isColumnValidForChannel(
          "metric:m1",
          "y",
          "areaY",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });
    });

    describe("dot (scatter) chart validation", () => {
      it("should accept numerical field for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_num456" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "num456" as UUID, columnName: "field_num456" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:num456",
          "x",
          "dot",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });

      it("should accept temporal field for X axis", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date789" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "date789" as UUID, columnName: "field_date789" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:date789",
          "x",
          "dot",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });

      it("should accept metric for X axis", () => {
        const analysis: ColumnAnalysis[] = [];
        const compiled = createCompiledInsight({
          metrics: [createMetric({ id: "m1" as UUID })],
        });

        const result = isColumnValidForChannel(
          "metric:m1",
          "x",
          "dot",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });

      it("should accept metric for Y axis", () => {
        const analysis: ColumnAnalysis[] = [];
        const compiled = createCompiledInsight({
          metrics: [createMetric({ id: "m1" as UUID })],
        });

        const result = isColumnValidForChannel(
          "metric:m1",
          "y",
          "dot",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });

      it("should reject categorical field for both axes", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_cat123" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "cat123" as UUID, columnName: "field_cat123" }),
          ],
        });

        const resultX = isColumnValidForChannel(
          "field:cat123",
          "x",
          "dot",
          analysis,
          compiled,
        );
        const resultY = isColumnValidForChannel(
          "field:cat123",
          "y",
          "dot",
          analysis,
          compiled,
        );

        expect(resultX.suitable).toBe(false);
        expect(resultX.reason).toContain("continuous");
        expect(resultY.suitable).toBe(false);
        expect(resultY.reason).toContain("continuous");
      });

      it("should reject identifier fields for both axes", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_user_id",
            semantic: "identifier",
          }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "user_id" as UUID, columnName: "field_user_id" }),
          ],
        });

        const resultX = isColumnValidForChannel(
          "field:user_id",
          "x",
          "dot",
          analysis,
          compiled,
        );
        const resultY = isColumnValidForChannel(
          "field:user_id",
          "y",
          "dot",
          analysis,
          compiled,
        );

        expect(resultX.suitable).toBe(false);
        expect(resultX.reason).toContain("Identifiers");
        expect(resultY.suitable).toBe(false);
        expect(resultY.reason).toContain("Identifiers");
      });
    });

    describe("color and size channels", () => {
      it("should accept any column for color channel", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_cat123" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "cat123" as UUID, columnName: "field_cat123" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:cat123",
          "color",
          "barY",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });

      it("should accept any column for size channel", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_num456" }),
        ];
        const compiled = createCompiledInsight({
          dimensions: [
            createField({ id: "num456" as UUID, columnName: "field_num456" }),
          ],
        });

        const result = isColumnValidForChannel(
          "field:num456",
          "size",
          "dot",
          analysis,
          compiled,
        );

        expect(result.suitable).toBe(true);
      });
    });
  });

  // ============================================================================
  // validateEncoding()
  // ============================================================================

  describe("validateEncoding()", () => {
    it("should return no errors for valid barY encoding", () => {
      const encoding = { x: "field:cat123", y: "metric:m1" };
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "field_cat123" }),
      ];
      const compiled = createCompiledInsight({
        dimensions: [
          createField({ id: "cat123" as UUID, columnName: "field_cat123" }),
        ],
        metrics: [createMetric({ id: "m1" as UUID })],
      });

      const errors = validateEncoding(encoding, "barY", analysis, compiled);

      expect(errors.x).toBeUndefined();
      expect(errors.y).toBeUndefined();
    });

    it("should return X error for invalid barY X encoding", () => {
      const encoding = { x: "metric:m1", y: "metric:m1" };
      const analysis: ColumnAnalysis[] = [];
      const compiled = createCompiledInsight({
        metrics: [createMetric({ id: "m1" as UUID })],
      });

      const errors = validateEncoding(encoding, "barY", analysis, compiled);

      expect(errors.x).toBeDefined();
      expect(errors.x).toContain("dimension");
      expect(errors.y).toBeUndefined();
    });

    it("should return Y error for invalid barY Y encoding", () => {
      const encoding = { x: "field:cat123", y: "field:cat123" };
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "field_cat123" }),
      ];
      const compiled = createCompiledInsight({
        dimensions: [
          createField({ id: "cat123" as UUID, columnName: "field_cat123" }),
        ],
      });

      const errors = validateEncoding(encoding, "barY", analysis, compiled);

      expect(errors.x).toBeUndefined();
      expect(errors.y).toBeDefined();
      expect(errors.y).toContain("metric");
    });

    it("should return both errors for invalid barY encoding", () => {
      const encoding = { x: "metric:m1", y: "field:cat123" };
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "field_cat123" }),
      ];
      const compiled = createCompiledInsight({
        dimensions: [
          createField({ id: "cat123" as UUID, columnName: "field_cat123" }),
        ],
        metrics: [createMetric({ id: "m1" as UUID })],
      });

      const errors = validateEncoding(encoding, "barY", analysis, compiled);

      expect(errors.x).toBeDefined();
      expect(errors.y).toBeDefined();
    });

    it("should return no errors for valid line encoding", () => {
      const encoding = { x: "field:date789", y: "metric:m1" };
      const analysis: ColumnAnalysis[] = [
        createDateColumn({ columnName: "field_date789" }),
      ];
      const compiled = createCompiledInsight({
        dimensions: [
          createField({ id: "date789" as UUID, columnName: "field_date789" }),
        ],
        metrics: [createMetric({ id: "m1" as UUID })],
      });

      const errors = validateEncoding(encoding, "line", analysis, compiled);

      expect(errors.x).toBeUndefined();
      expect(errors.y).toBeUndefined();
    });

    it("should return error for categorical X in line chart", () => {
      const encoding = { x: "field:cat123", y: "metric:m1" };
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "field_cat123" }),
      ];
      const compiled = createCompiledInsight({
        dimensions: [
          createField({ id: "cat123" as UUID, columnName: "field_cat123" }),
        ],
        metrics: [createMetric({ id: "m1" as UUID })],
      });

      const errors = validateEncoding(encoding, "line", analysis, compiled);

      expect(errors.x).toBeDefined();
      expect(errors.x).toContain("continuous");
    });

    it("should return no errors for valid scatter encoding", () => {
      const encoding = { x: "field:num1", y: "field:num2" };
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({ columnName: "field_num1" }),
        createNumberColumn({ columnName: "field_num2" }),
      ];
      const compiled = createCompiledInsight({
        dimensions: [
          createField({ id: "num1" as UUID, columnName: "field_num1" }),
          createField({ id: "num2" as UUID, columnName: "field_num2" }),
        ],
      });

      const errors = validateEncoding(encoding, "dot", analysis, compiled);

      expect(errors.x).toBeUndefined();
      expect(errors.y).toBeUndefined();
    });

    it("should handle empty encoding gracefully", () => {
      const encoding = {};
      const analysis: ColumnAnalysis[] = [];
      const compiled = createCompiledInsight();

      const errors = validateEncoding(encoding, "barY", analysis, compiled);

      expect(errors.x).toBeUndefined();
      expect(errors.y).toBeUndefined();
    });

    it("should handle empty analysis gracefully", () => {
      const encoding = { x: "field:cat123", y: "metric:m1" };
      const analysis: ColumnAnalysis[] = [];
      const compiled = createCompiledInsight({
        dimensions: [
          createField({ id: "cat123" as UUID, columnName: "field_cat123" }),
        ],
        metrics: [createMetric({ id: "m1" as UUID })],
      });

      const errors = validateEncoding(encoding, "barY", analysis, compiled);

      // Should not crash, but may return errors since column analysis is missing
      expect(errors).toBeDefined();
    });
  });

  // ============================================================================
  // isSwapAllowed()
  // ============================================================================

  describe("isSwapAllowed()", () => {
    it("should allow swap for barY chart", () => {
      expect(isSwapAllowed("barY")).toBe(true);
    });

    it("should allow swap for barX chart", () => {
      expect(isSwapAllowed("barX")).toBe(true);
    });

    it("should allow swap for dot (scatter) chart", () => {
      expect(isSwapAllowed("dot")).toBe(true);
    });

    it("should not allow swap for line chart", () => {
      expect(isSwapAllowed("line")).toBe(false);
    });

    it("should not allow swap for areaY chart", () => {
      expect(isSwapAllowed("areaY")).toBe(false);
    });

    it("should not allow swap for hexbin chart", () => {
      expect(isSwapAllowed("hexbin")).toBe(false);
    });

    it("should not allow swap for heatmap chart", () => {
      expect(isSwapAllowed("heatmap")).toBe(false);
    });

    it("should not allow swap for raster chart", () => {
      expect(isSwapAllowed("raster")).toBe(false);
    });
  });

  // ============================================================================
  // getSwappedChartType()
  // ============================================================================

  describe("getSwappedChartType()", () => {
    it("should swap barY to barX", () => {
      expect(getSwappedChartType("barY")).toBe("barX");
    });

    it("should swap barX to barY", () => {
      expect(getSwappedChartType("barX")).toBe("barY");
    });

    it("should keep dot chart as dot", () => {
      expect(getSwappedChartType("dot")).toBe("dot");
    });

    it("should keep line chart as line", () => {
      expect(getSwappedChartType("line")).toBe("line");
    });

    it("should keep areaY chart as areaY", () => {
      expect(getSwappedChartType("areaY")).toBe("areaY");
    });

    it("should keep hexbin chart as hexbin", () => {
      expect(getSwappedChartType("hexbin")).toBe("hexbin");
    });

    it("should keep heatmap chart as heatmap", () => {
      expect(getSwappedChartType("heatmap")).toBe("heatmap");
    });

    it("should keep raster chart as raster", () => {
      expect(getSwappedChartType("raster")).toBe("raster");
    });
  });

  // ============================================================================
  // getAxisSemanticLabel()
  // ============================================================================

  describe("getAxisSemanticLabel()", () => {
    describe("barY chart labels", () => {
      it("should return 'Category' for X axis", () => {
        expect(getAxisSemanticLabel("x", "barY")).toBe("Category");
      });

      it("should return 'Value' for Y axis", () => {
        expect(getAxisSemanticLabel("y", "barY")).toBe("Value");
      });
    });

    describe("barX chart labels", () => {
      it("should return 'Value' for X axis", () => {
        expect(getAxisSemanticLabel("x", "barX")).toBe("Value");
      });

      it("should return 'Category' for Y axis", () => {
        expect(getAxisSemanticLabel("y", "barX")).toBe("Category");
      });
    });

    describe("line chart labels", () => {
      it("should return 'Continuous' for X axis", () => {
        expect(getAxisSemanticLabel("x", "line")).toBe("Continuous");
      });

      it("should return 'Measure' for Y axis", () => {
        expect(getAxisSemanticLabel("y", "line")).toBe("Measure");
      });
    });

    describe("areaY chart labels", () => {
      it("should return 'Continuous' for X axis", () => {
        expect(getAxisSemanticLabel("x", "areaY")).toBe("Continuous");
      });

      it("should return 'Measure' for Y axis", () => {
        expect(getAxisSemanticLabel("y", "areaY")).toBe("Measure");
      });
    });

    describe("dot (scatter) chart labels", () => {
      it("should return 'Continuous' for X axis", () => {
        expect(getAxisSemanticLabel("x", "dot")).toBe("Continuous");
      });

      it("should return 'Continuous' for Y axis", () => {
        expect(getAxisSemanticLabel("y", "dot")).toBe("Continuous");
      });
    });

    describe("other chart types", () => {
      it("should return empty string for hexbin X axis", () => {
        expect(getAxisSemanticLabel("x", "hexbin")).toBe("");
      });

      it("should return empty string for heatmap Y axis", () => {
        expect(getAxisSemanticLabel("y", "heatmap")).toBe("");
      });
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("integration tests", () => {
    it("should validate complete workflow for bar chart creation", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "field_region",
          semantic: "categorical",
        }),
        createNumberColumn({ columnName: "field_revenue" }),
      ];
      const compiled = createCompiledInsight({
        dimensions: [
          createField({ id: "region" as UUID, columnName: "field_region" }),
          createField({ id: "revenue" as UUID, columnName: "field_revenue" }),
        ],
        metrics: [createMetric({ id: "m1" as UUID, name: "total_revenue" })],
      });

      // Step 1: Get valid columns for each axis
      const validX = getValidColumnsForChannel("x", "barY", analysis, compiled);
      const validY = getValidColumnsForChannel("y", "barY", analysis, compiled);

      expect(validX).toContain("field_region");
      expect(validY).toContain("total_revenue");

      // Step 2: Validate selected encoding
      const encoding = { x: "field:region", y: "metric:m1" };
      const errors = validateEncoding(encoding, "barY", analysis, compiled);

      expect(errors.x).toBeUndefined();
      expect(errors.y).toBeUndefined();

      // Step 3: Check if swap is allowed
      expect(isSwapAllowed("barY")).toBe(true);

      // Step 4: Get swapped chart type
      const swapped = getSwappedChartType("barY");
      expect(swapped).toBe("barX");

      // Step 5: Validate swapped encoding
      const swappedErrors = validateEncoding(
        { x: encoding.y, y: encoding.x },
        swapped,
        analysis,
        compiled,
      );
      expect(swappedErrors.x).toBeUndefined();
      expect(swappedErrors.y).toBeUndefined();
    });

    it("should validate complete workflow for line chart creation", () => {
      const analysis: ColumnAnalysis[] = [
        createDateColumn({ columnName: "field_date" }),
        createNumberColumn({ columnName: "field_value" }),
      ];
      const compiled = createCompiledInsight({
        dimensions: [
          createField({ id: "date" as UUID, columnName: "field_date" }),
          createField({ id: "value" as UUID, columnName: "field_value" }),
        ],
        metrics: [createMetric({ id: "m1" as UUID, name: "total_value" })],
      });

      // Get valid columns
      const validX = getValidColumnsForChannel("x", "line", analysis, compiled);
      const validY = getValidColumnsForChannel("y", "line", analysis, compiled);

      expect(validX).toContain("field_date");
      expect(validY).toContain("total_value");

      // Validate encoding
      const encoding = { x: "field:date", y: "metric:m1" };
      const errors = validateEncoding(encoding, "line", analysis, compiled);

      expect(errors.x).toBeUndefined();
      expect(errors.y).toBeUndefined();

      // Check swap not allowed for line charts
      expect(isSwapAllowed("line")).toBe(false);
    });

    it("should handle transition between bar chart orientations", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "field_category" }),
      ];
      const compiled = createCompiledInsight({
        dimensions: [
          createField({ id: "category" as UUID, columnName: "field_category" }),
        ],
        metrics: [createMetric({ id: "m1" as UUID })],
      });

      // Start with vertical bar
      const barYEncoding = { x: "field:category", y: "metric:m1" };
      const barYErrors = validateEncoding(
        barYEncoding,
        "barY",
        analysis,
        compiled,
      );
      expect(barYErrors.x).toBeUndefined();
      expect(barYErrors.y).toBeUndefined();

      // Swap to horizontal bar
      const newChartType = getSwappedChartType("barY");
      const barXEncoding = { x: barYEncoding.y, y: barYEncoding.x };
      const barXErrors = validateEncoding(
        barXEncoding,
        newChartType,
        analysis,
        compiled,
      );
      expect(barXErrors.x).toBeUndefined();
      expect(barXErrors.y).toBeUndefined();

      // Get axis labels for both orientations
      expect(getAxisSemanticLabel("x", "barY")).toBe("Category");
      expect(getAxisSemanticLabel("y", "barY")).toBe("Value");
      expect(getAxisSemanticLabel("x", "barX")).toBe("Value");
      expect(getAxisSemanticLabel("y", "barX")).toBe("Category");
    });
  });

  // ============================================================================
  // Type Safety Tests
  // ============================================================================

  describe("type safety", () => {
    it("should handle all visualization types without errors", () => {
      const chartTypes = [
        "barY",
        "barX",
        "line",
        "areaY",
        "dot",
        "hexbin",
        "heatmap",
        "raster",
      ] as const;

      for (const chartType of chartTypes) {
        expect(() => isSwapAllowed(chartType)).not.toThrow();
        expect(() => getSwappedChartType(chartType)).not.toThrow();
        expect(() => getAxisSemanticLabel("x", chartType)).not.toThrow();
        expect(() => getAxisSemanticLabel("y", chartType)).not.toThrow();
      }
    });

    it("should handle all encoding channels without errors", () => {
      const channels = ["x", "y", "color", "size"] as const;
      const analysis: ColumnAnalysis[] = [createStringColumn()];

      for (const channel of channels) {
        expect(() =>
          getValidColumnsForChannel(channel, "barY", analysis),
        ).not.toThrow();
      }
    });

    it("should return consistent types", () => {
      const analysis: ColumnAnalysis[] = [createStringColumn()];

      // getValidColumnsForChannel should return string array
      const result1 = getValidColumnsForChannel("x", "barY", analysis);
      expect(Array.isArray(result1)).toBe(true);
      expect(result1.every((item) => typeof item === "string")).toBe(true);

      // isSwapAllowed should return boolean
      const result2 = isSwapAllowed("barY");
      expect(typeof result2).toBe("boolean");

      // getSwappedChartType should return VisualizationType
      const result3 = getSwappedChartType("barY");
      expect(typeof result3).toBe("string");

      // getAxisSemanticLabel should return string
      const result4 = getAxisSemanticLabel("x", "barY");
      expect(typeof result4).toBe("string");
    });
  });
});
