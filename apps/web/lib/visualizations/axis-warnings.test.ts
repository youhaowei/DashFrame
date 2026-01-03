/**
 * Unit tests for axis-warnings module
 *
 * Tests cover:
 * - getColumnWarning() - Column-based warning generation
 *   - Color channel warnings (identifiers, duplicates, cardinality)
 *   - Size channel warnings (numerical requirement, duplicates)
 *   - Bar chart axis warnings (dimension/measure pairing)
 *   - Y-axis warnings for line/area/scatter charts
 *   - X-axis warnings for line/area/scatter charts
 *   - Same column on both axes detection
 * - getEncodingWarning() - EncodingValue-based warning generation
 *   - Invalid encoding format
 *   - Same metric on both axes
 *   - Field resolution and delegation
 * - getRankedColumnOptions() - Column ranking and scoring
 *   - Chart type-specific scoring
 *   - Warning propagation
 *   - Proper sorting by suitability
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
  getColumnWarning,
  getEncodingWarning,
  getRankedColumnOptions,
  type AxisWarning,
  type RankedColumnOption,
} from "./axis-warnings";

describe("axis-warnings", () => {
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
    trueCount: 50,
    falseCount: 50,
    fieldId: "bool999",
    ...overrides,
  });

  const createField = (overrides: Partial<Field> = {}): Field => ({
    id: "field123" as UUID,
    name: "Test Field",
    sourceColumn: "test_column",
    ...overrides,
  });

  const createMetric = (overrides: Partial<InsightMetric> = {}): InsightMetric => ({
    id: "metric123" as UUID,
    name: "Test Metric",
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
  // getColumnWarning() - Color Channel
  // ============================================================================

  describe("getColumnWarning() - color channel", () => {
    it("should warn when color is an identifier", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "user_id",
          semantic: "identifier",
        }),
      ];

      const warning = getColumnWarning("user_id", "color", "barY", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Not suitable for color");
      expect(warning?.reason).toContain("Unique IDs or references");
    });

    it("should warn when color is a UUID", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "uuid",
          semantic: "uuid",
        }),
      ];

      const warning = getColumnWarning("uuid", "color", "barY", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Not suitable for color");
    });

    it("should warn when color is a reference (URL)", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "website",
          semantic: "url",
        }),
      ];

      const warning = getColumnWarning("website", "color", "barY", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Not suitable for color");
    });

    it("should warn when color is a reference (email)", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "email",
          semantic: "email",
        }),
      ];

      const warning = getColumnWarning("email", "color", "barY", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Not suitable for color");
    });

    it("should warn when color is already used on X axis", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
      ];

      const warning = getColumnWarning("category", "color", "barY", analysis, {
        x: "category",
      });

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Already used on axis");
      expect(warning?.reason).toContain("already encoded on an axis");
    });

    it("should warn when color is already used on Y axis", () => {
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({ columnName: "revenue" }),
      ];

      const warning = getColumnWarning("revenue", "color", "barY", analysis, {
        y: "revenue",
      });

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Already used on axis");
    });

    it("should warn when categorical color has too many categories (>12)", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "product",
          cardinality: 20,
        }),
      ];

      const warning = getColumnWarning("product", "color", "barY", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Too many categories");
      expect(warning?.reason).toContain("More than 12");
    });

    it("should warn when boolean color has too many distinct values", () => {
      const analysis: ColumnAnalysis[] = [
        createBooleanColumn({
          columnName: "flag",
          cardinality: 15, // Unusual but possible with nulls
        }),
      ];

      const warning = getColumnWarning("flag", "color", "barY", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Too many categories");
    });

    it("should not warn when categorical color has acceptable cardinality (≤12)", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "category",
          cardinality: 8,
        }),
      ];

      const warning = getColumnWarning("category", "color", "barY", analysis);

      expect(warning).toBeNull();
    });

    it("should warn when numerical color has high cardinality (>20)", () => {
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({
          columnName: "price",
          cardinality: 50,
        }),
      ];

      const warning = getColumnWarning("price", "color", "barY", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Consider a categorical column");
      expect(warning?.reason).toContain("Numerical measures work better on axes");
    });

    it("should not warn for temporal columns even with high cardinality", () => {
      const analysis: ColumnAnalysis[] = [
        createDateColumn({
          columnName: "date",
          cardinality: 365,
        }),
      ];

      const warning = getColumnWarning("date", "color", "barY", analysis);

      expect(warning).toBeNull();
    });

    it("should not warn when numerical color has acceptable cardinality (≤20)", () => {
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({
          columnName: "rating",
          cardinality: 5,
        }),
      ];

      const warning = getColumnWarning("rating", "color", "barY", analysis);

      expect(warning).toBeNull();
    });
  });

  // ============================================================================
  // getColumnWarning() - Size Channel
  // ============================================================================

  describe("getColumnWarning() - size channel", () => {
    it("should warn when size is not numerical", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
      ];

      const warning = getColumnWarning("category", "size", "dot", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Numerical column recommended");
      expect(warning?.reason).toContain("Size encoding requires numerical values");
    });

    it("should not warn when size is numerical", () => {
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({ columnName: "population" }),
      ];

      const warning = getColumnWarning("population", "size", "dot", analysis);

      expect(warning).toBeNull();
    });

    it("should warn when size is already used on X axis", () => {
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({ columnName: "revenue" }),
      ];

      const warning = getColumnWarning("revenue", "size", "dot", analysis, {
        x: "revenue",
      });

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Already used on axis");
      expect(warning?.reason).toContain("redundant");
    });

    it("should warn when size is already used on Y axis", () => {
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({ columnName: "profit" }),
      ];

      const warning = getColumnWarning("profit", "size", "dot", analysis, {
        y: "profit",
      });

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Already used on axis");
    });
  });

  // ============================================================================
  // getColumnWarning() - Bar Chart Axes
  // ============================================================================

  describe("getColumnWarning() - barY chart", () => {
    it("should warn when X-axis is an identifier", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "product_id",
          semantic: "identifier",
        }),
      ];

      const warning = getColumnWarning("product_id", "x", "barY", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Not suitable for bar charts");
      expect(warning?.reason).toContain("unique labels or IDs");
    });

    it("should warn when Y-axis is an identifier", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "order_id",
          semantic: "identifier",
        }),
      ];

      const warning = getColumnWarning("order_id", "y", "barY", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Not suitable for bar charts");
    });

    it("should warn when both axes are numerical", () => {
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({ columnName: "revenue" }),
        createNumberColumn({ columnName: "profit" }),
      ];

      const warning = getColumnWarning("profit", "x", "barY", analysis, {
        y: "revenue",
      });

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Consider a categorical column");
      expect(warning?.reason).toContain("other axis already has a numerical measure");
    });

    it("should warn when both axes are categorical", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
        createStringColumn({ columnName: "region" }),
      ];

      const warning = getColumnWarning("category", "y", "barY", analysis, {
        x: "region",
      });

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Numerical column recommended");
      expect(warning?.reason).toContain("other axis already has a categorical dimension");
    });

    it("should warn when numerical X-axis has many values (>20)", () => {
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({
          columnName: "price",
          cardinality: 50,
        }),
      ];

      const warning = getColumnWarning("price", "x", "barY", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Many unique values");
      expect(warning?.reason).toContain("Histogram or Scatter plot");
    });

    it("should not warn for valid barY configuration (categorical X, numerical Y)", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
        createNumberColumn({ columnName: "revenue" }),
      ];

      const xWarning = getColumnWarning("category", "x", "barY", analysis, {
        y: "revenue",
      });
      const yWarning = getColumnWarning("revenue", "y", "barY", analysis, {
        x: "category",
      });

      expect(xWarning).toBeNull();
      expect(yWarning).toBeNull();
    });

    it("should not warn for valid barY configuration (temporal X, numerical Y)", () => {
      const analysis: ColumnAnalysis[] = [
        createDateColumn({ columnName: "date" }),
        createNumberColumn({ columnName: "sales" }),
      ];

      const xWarning = getColumnWarning("date", "x", "barY", analysis, {
        y: "sales",
      });
      const yWarning = getColumnWarning("sales", "y", "barY", analysis, {
        x: "date",
      });

      expect(xWarning).toBeNull();
      expect(yWarning).toBeNull();
    });
  });

  // ============================================================================
  // getColumnWarning() - Line/Area Charts
  // ============================================================================

  describe("getColumnWarning() - line chart", () => {
    it("should warn when Y-axis is not numerical", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
      ];

      const warning = getColumnWarning("category", "y", "line", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Numerical column recommended");
      expect(warning?.reason).toContain("Line charts need numerical values on the Y-axis");
    });

    it("should warn when Y-axis is an identifier", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "id",
          semantic: "identifier",
        }),
      ];

      const warning = getColumnWarning("id", "y", "line", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Not a measurable value");
      expect(warning?.reason).toContain("cannot be aggregated");
    });

    it("should warn when X-axis has too many categories (>20)", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "product",
          cardinality: 30,
        }),
      ];

      const warning = getColumnWarning("product", "x", "line", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Too many categories");
      expect(warning?.reason).toContain("cluttered");
    });

    it("should warn when X-axis is not ordered (not temporal/numerical/categorical)", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "text",
          semantic: "reference",
        }),
      ];

      const warning = getColumnWarning("text", "x", "line", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Ordered column recommended");
      expect(warning?.reason).toContain("time-series or continuous data");
    });

    it("should not warn for valid line configuration (temporal X, numerical Y)", () => {
      const analysis: ColumnAnalysis[] = [
        createDateColumn({ columnName: "date" }),
        createNumberColumn({ columnName: "revenue" }),
      ];

      const xWarning = getColumnWarning("date", "x", "line", analysis, {
        y: "revenue",
      });
      const yWarning = getColumnWarning("revenue", "y", "line", analysis, {
        x: "date",
      });

      expect(xWarning).toBeNull();
      expect(yWarning).toBeNull();
    });
  });

  describe("getColumnWarning() - areaY chart", () => {
    it("should warn when Y-axis is not numerical", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
      ];

      const warning = getColumnWarning("category", "y", "areaY", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Numerical column recommended");
      expect(warning?.reason).toContain("Areay charts need numerical values on the Y-axis");
    });

    it("should warn when X-axis has too many categories (>20)", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "month",
          cardinality: 25,
        }),
      ];

      const warning = getColumnWarning("month", "x", "areaY", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Too many categories");
    });
  });

  // ============================================================================
  // getColumnWarning() - Scatter Plot
  // ============================================================================

  describe("getColumnWarning() - dot (scatter) chart", () => {
    it("should warn when X-axis is not numerical", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
      ];

      const warning = getColumnWarning("category", "x", "dot", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Numerical column recommended");
      expect(warning?.reason).toContain("Scatter plots need numerical values on both axes");
    });

    it("should warn when Y-axis is not numerical", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
      ];

      const warning = getColumnWarning("category", "y", "dot", analysis);

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Numerical column recommended");
      expect(warning?.reason).toContain("Dot charts need numerical values on the Y-axis");
    });

    it("should not warn for valid scatter configuration (numerical on both axes)", () => {
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({ columnName: "revenue" }),
        createNumberColumn({ columnName: "profit" }),
      ];

      const xWarning = getColumnWarning("revenue", "x", "dot", analysis, {
        y: "profit",
      });
      const yWarning = getColumnWarning("profit", "y", "dot", analysis, {
        x: "revenue",
      });

      expect(xWarning).toBeNull();
      expect(yWarning).toBeNull();
    });
  });

  // ============================================================================
  // getColumnWarning() - Same Column on Both Axes
  // ============================================================================

  describe("getColumnWarning() - same column on both axes", () => {
    it("should warn when same column is selected for both X and Y axes", () => {
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({ columnName: "value" }),
      ];

      const warning = getColumnWarning("value", "x", "dot", analysis, {
        y: "value",
      });

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Same column on both axes");
      expect(warning?.reason).toContain("Comparing a column to itself");
    });
  });

  // ============================================================================
  // getColumnWarning() - Edge Cases
  // ============================================================================

  describe("getColumnWarning() - edge cases", () => {
    it("should return null when column name is undefined", () => {
      const analysis: ColumnAnalysis[] = [];

      const warning = getColumnWarning(undefined, "x", "barY", analysis);

      expect(warning).toBeNull();
    });

    it("should return null when column is not found in analysis", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "other" }),
      ];

      const warning = getColumnWarning("missing", "x", "barY", analysis);

      expect(warning).toBeNull();
    });

    it("should return null when analysis is empty", () => {
      const warning = getColumnWarning("column", "x", "barY", []);

      expect(warning).toBeNull();
    });
  });

  // ============================================================================
  // getEncodingWarning() - Encoding Value Validation
  // ============================================================================

  describe("getEncodingWarning()", () => {
    it("should warn for invalid encoding format", () => {
      const analysis: ColumnAnalysis[] = [];
      const compiledInsight = createCompiledInsight();

      const warning = getEncodingWarning(
        "invalid-format",
        "x",
        "barY",
        analysis,
        compiledInsight,
      );

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Invalid encoding");
      expect(warning?.reason).toContain("invalid format");
    });

    it("should warn when same metric is used on both axes", () => {
      const metric = createMetric({ id: "metric123" as UUID });
      const analysis: ColumnAnalysis[] = [];
      const compiledInsight = createCompiledInsight({
        metrics: [metric],
      });

      const warning = getEncodingWarning(
        "metric:metric123",
        "x",
        "dot",
        analysis,
        compiledInsight,
        "metric:metric123",
      );

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Same metric on both axes");
      expect(warning?.reason).toContain("Comparing a metric to itself");
    });

    it("should not warn for different metrics on axes", () => {
      const metric1 = createMetric({ id: "metric1" as UUID });
      const metric2 = createMetric({ id: "metric2" as UUID });
      const analysis: ColumnAnalysis[] = [];
      const compiledInsight = createCompiledInsight({
        metrics: [metric1, metric2],
      });

      const warning = getEncodingWarning(
        "metric:metric1",
        "x",
        "dot",
        analysis,
        compiledInsight,
        "metric:metric2",
      );

      expect(warning).toBeNull();
    });

    it("should not warn for valid metric encoding", () => {
      const metric = createMetric({ id: "metric123" as UUID });
      const analysis: ColumnAnalysis[] = [];
      const compiledInsight = createCompiledInsight({
        metrics: [metric],
      });

      const warning = getEncodingWarning(
        "metric:metric123",
        "y",
        "barY",
        analysis,
        compiledInsight,
      );

      expect(warning).toBeNull();
    });

    it("should warn when field cannot be resolved", () => {
      const field = createField({ id: "field123" as UUID });
      const analysis: ColumnAnalysis[] = [];
      const compiledInsight = createCompiledInsight({
        dimensions: [field],
      });

      const warning = getEncodingWarning(
        "field:field123",
        "x",
        "barY",
        analysis,
        compiledInsight,
      );

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Field not found");
      expect(warning?.reason).toContain("could not be resolved");
    });

    it("should delegate to getColumnWarning for field encodings", () => {
      const field = createField({
        id: "field123" as UUID,
        sourceColumn: "category",
      });
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "category",
          semantic: "identifier",
        }),
      ];
      const compiledInsight = createCompiledInsight({
        dimensions: [field],
      });

      const warning = getEncodingWarning(
        "field:field123",
        "x",
        "barY",
        analysis,
        compiledInsight,
      );

      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Not suitable for bar charts");
    });

    it("should handle field encodings with otherAxisEncodingValue", () => {
      const field1 = createField({
        id: "field1" as UUID,
        sourceColumn: "column1",
      });
      const field2 = createField({
        id: "field2" as UUID,
        sourceColumn: "column2",
      });
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({ columnName: "column1" }),
        createNumberColumn({ columnName: "column2" }),
      ];
      const compiledInsight = createCompiledInsight({
        dimensions: [field1, field2],
      });

      const warning = getEncodingWarning(
        "field:field1",
        "x",
        "barY",
        analysis,
        compiledInsight,
        "field:field2",
      );

      // Should get warning about both axes being numerical for barY
      expect(warning).not.toBeNull();
      expect(warning?.message).toBe("Consider a categorical column");
    });

    it("should return null when encodingValue is undefined", () => {
      const analysis: ColumnAnalysis[] = [];
      const compiledInsight = createCompiledInsight();

      const warning = getEncodingWarning(
        undefined,
        "x",
        "barY",
        analysis,
        compiledInsight,
      );

      expect(warning).toBeNull();
    });
  });

  // ============================================================================
  // getRankedColumnOptions() - Column Scoring and Ranking
  // ============================================================================

  describe("getRankedColumnOptions()", () => {
    it("should rank categorical column higher for barY X-axis", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
        createNumberColumn({ columnName: "revenue" }),
      ];

      const options = getRankedColumnOptions(
        ["category", "revenue"],
        "x",
        "barY",
        analysis,
      );

      expect(options[0].value).toBe("category");
      expect(options[0].score).toBeGreaterThan(options[1].score);
    });

    it("should rank numerical column higher for barY Y-axis", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
        createNumberColumn({ columnName: "revenue" }),
      ];

      const options = getRankedColumnOptions(
        ["category", "revenue"],
        "y",
        "barY",
        analysis,
      );

      expect(options[0].value).toBe("revenue");
      expect(options[0].score).toBeGreaterThan(options[1].score);
    });

    it("should rank temporal column higher for line X-axis", () => {
      const analysis: ColumnAnalysis[] = [
        createDateColumn({ columnName: "date" }),
        createStringColumn({ columnName: "category" }),
        createNumberColumn({ columnName: "value" }),
      ];

      const options = getRankedColumnOptions(
        ["date", "category", "value"],
        "x",
        "line",
        analysis,
      );

      expect(options[0].value).toBe("date");
    });

    it("should rank numerical column higher for dot (scatter) X-axis", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
        createNumberColumn({ columnName: "revenue" }),
        createNumberColumn({ columnName: "profit" }),
      ];

      const options = getRankedColumnOptions(
        ["category", "revenue", "profit"],
        "x",
        "dot",
        analysis,
      );

      expect(options[0].value).toMatch(/^(revenue|profit)$/);
      expect(options[0].score).toBeGreaterThan(options[2].score);
    });

    it("should rank numerical column higher for dot (scatter) Y-axis", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
        createNumberColumn({ columnName: "revenue" }),
      ];

      const options = getRankedColumnOptions(
        ["category", "revenue"],
        "y",
        "dot",
        analysis,
      );

      expect(options[0].value).toBe("revenue");
      expect(options[0].score).toBeGreaterThan(options[1].score);
    });

    it("should penalize identifier columns", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "user_id",
          semantic: "identifier",
        }),
        createStringColumn({ columnName: "category" }),
      ];

      const options = getRankedColumnOptions(
        ["user_id", "category"],
        "x",
        "barY",
        analysis,
      );

      expect(options[0].value).toBe("category");
      expect(options[1].value).toBe("user_id");
      expect(options[0].score).toBeGreaterThan(options[1].score);
    });

    it("should penalize columns already used on other axis", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
        createStringColumn({ columnName: "region" }),
      ];

      const options = getRankedColumnOptions(
        ["category", "region"],
        "x",
        "barY",
        analysis,
        "category", // Already used on Y-axis
      );

      expect(options[0].value).toBe("region");
      expect(options[1].value).toBe("category");
      expect(options[0].score).toBeGreaterThan(options[1].score);
    });

    it("should include warnings in ranked options", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "user_id",
          semantic: "identifier",
        }),
      ];

      const options = getRankedColumnOptions(
        ["user_id"],
        "x",
        "barY",
        analysis,
      );

      expect(options[0].warning).not.toBeUndefined();
      expect(options[0].warning?.message).toBe("Not suitable for bar charts");
    });

    it("should sort options by score in descending order", () => {
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({ columnName: "revenue" }),
        createStringColumn({ columnName: "category" }),
        createDateColumn({ columnName: "date" }),
      ];

      const options = getRankedColumnOptions(
        ["revenue", "category", "date"],
        "x",
        "barY",
        analysis,
      );

      // Verify sorted by score descending
      for (let i = 0; i < options.length - 1; i++) {
        expect(options[i].score).toBeGreaterThanOrEqual(options[i + 1].score);
      }
    });

    it("should handle columns not in analysis", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
      ];

      const options = getRankedColumnOptions(
        ["category", "unknown"],
        "x",
        "barY",
        analysis,
      );

      expect(options).toHaveLength(2);
      const unknownOption = options.find((opt) => opt.value === "unknown");
      expect(unknownOption).toBeDefined();
      expect(unknownOption?.score).toBe(0);
    });

    it("should handle empty columns array", () => {
      const analysis: ColumnAnalysis[] = [];

      const options = getRankedColumnOptions([], "x", "barY", analysis);

      expect(options).toEqual([]);
    });

    it("should rank correctly for barX (inverted from barY)", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category" }),
        createNumberColumn({ columnName: "revenue" }),
      ];

      const xOptions = getRankedColumnOptions(
        ["category", "revenue"],
        "x",
        "barX",
        analysis,
      );
      const yOptions = getRankedColumnOptions(
        ["category", "revenue"],
        "y",
        "barX",
        analysis,
      );

      // For barX: X should prefer numerical, Y should prefer categorical
      expect(xOptions[0].value).toBe("revenue");
      expect(yOptions[0].value).toBe("category");
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("integration tests", () => {
    it("should provide consistent warnings between getColumnWarning and getRankedColumnOptions", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "user_id",
          semantic: "identifier",
        }),
      ];

      const directWarning = getColumnWarning("user_id", "x", "barY", analysis);
      const rankedOptions = getRankedColumnOptions(
        ["user_id"],
        "x",
        "barY",
        analysis,
      );

      expect(directWarning).not.toBeNull();
      expect(rankedOptions[0].warning).not.toBeUndefined();
      expect(rankedOptions[0].warning?.message).toBe(directWarning?.message);
      expect(rankedOptions[0].warning?.reason).toBe(directWarning?.reason);
    });

    it("should handle complete workflow: encoding -> column -> warning -> ranking", () => {
      const field = createField({
        id: "field123" as UUID,
        sourceColumn: "category",
      });
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "category", cardinality: 5 }),
        createNumberColumn({ columnName: "revenue" }),
      ];
      const compiledInsight = createCompiledInsight({
        dimensions: [field],
      });

      // 1. Get encoding warning
      const encodingWarning = getEncodingWarning(
        "field:field123",
        "x",
        "barY",
        analysis,
        compiledInsight,
      );

      // 2. Get column warning
      const columnWarning = getColumnWarning(
        "category",
        "x",
        "barY",
        analysis,
      );

      // 3. Get ranked options
      const rankedOptions = getRankedColumnOptions(
        ["category", "revenue"],
        "x",
        "barY",
        analysis,
      );

      // Should all be consistent (category is good for barY X-axis)
      expect(encodingWarning).toBeNull();
      expect(columnWarning).toBeNull();
      expect(rankedOptions[0].value).toBe("category");
      expect(rankedOptions[0].warning).toBeUndefined();
    });
  });

  // ============================================================================
  // Type Safety Tests
  // ============================================================================

  describe("type safety", () => {
    it("should return AxisWarning | null from getColumnWarning", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "test" }),
      ];

      const warning = getColumnWarning("test", "x", "barY", analysis);

      if (warning !== null) {
        expect(warning).toHaveProperty("message");
        expect(warning).toHaveProperty("reason");
        expect(typeof warning.message).toBe("string");
        expect(typeof warning.reason).toBe("string");
      }
    });

    it("should return RankedColumnOption[] from getRankedColumnOptions", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "test" }),
      ];

      const options = getRankedColumnOptions(["test"], "x", "barY", analysis);

      expect(Array.isArray(options)).toBe(true);
      options.forEach((option) => {
        expect(option).toHaveProperty("label");
        expect(option).toHaveProperty("value");
        expect(option).toHaveProperty("score");
        expect(typeof option.label).toBe("string");
        expect(typeof option.value).toBe("string");
        expect(typeof option.score).toBe("number");
      });
    });
  });
});
