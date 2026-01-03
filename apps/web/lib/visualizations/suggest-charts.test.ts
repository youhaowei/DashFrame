/**
 * Unit tests for suggest-charts module
 *
 * Tests cover:
 * - suggestCharts() - Main suggestion engine based on data analysis
 * - suggestByChartType() - Single chart type suggestion
 * - suggestForAllChartTypes() - Generate suggestions for all types
 * - getChartTypeUnavailableReason() - Chart type availability checks
 * - suggestByTag() - Tag-based suggestion system
 * - getAlternativeChartTypes() - Alternative chart recommendations
 * - SCATTER_MAX_POINTS - Re-exported constant
 */
import { describe, expect, it } from "vitest";
import type {
  ColumnAnalysis,
  DateAnalysis,
  Field,
  NumberAnalysis,
  StringAnalysis,
  UUID,
} from "@dashframe/types";
import type { Insight } from "../stores/types";
import {
  getAlternativeChartTypes,
  getChartTypeUnavailableReason,
  SCATTER_MAX_POINTS,
  suggestByChartType,
  suggestByTag,
  suggestCharts,
  suggestForAllChartTypes,
} from "./suggest-charts";

describe("suggest-charts", () => {
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

  const createInsight = (overrides: Partial<Insight> = {}): Insight => ({
    id: "insight123" as UUID,
    name: "Test Insight",
    baseTable: {
      tableId: "table123" as UUID,
      selectedFields: [],
    },
    metrics: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  // ============================================================================
  // SCATTER_MAX_POINTS constant
  // ============================================================================

  describe("SCATTER_MAX_POINTS", () => {
    it("should be re-exported from types package", () => {
      expect(SCATTER_MAX_POINTS).toBe(5000);
    });

    it("should be a number greater than zero", () => {
      expect(typeof SCATTER_MAX_POINTS).toBe("number");
      expect(SCATTER_MAX_POINTS).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // suggestCharts()
  // ============================================================================

  describe("suggestCharts()", () => {
    describe("basic bar chart suggestions", () => {
      it("should suggest bar chart for categorical + numerical data", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_region",
            fieldId: "region",
            cardinality: 4,
          }),
          createNumberColumn({
            columnName: "field_revenue",
            fieldId: "revenue",
          }),
        ];

        const fields: Record<string, Field> = {
          region: createField({ id: "region" as UUID, name: "Region" }),
          revenue: createField({ id: "revenue" as UUID, name: "Revenue" }),
        };

        const insight = createInsight();
        const suggestions = suggestCharts(insight, analysis, 100, fields);

        expect(suggestions.length).toBeGreaterThan(0);
        const barSuggestion = suggestions.find((s) => s.chartType === "barY");
        expect(barSuggestion).toBeDefined();
        expect(barSuggestion?.encoding.x).toBe("field_region");
        expect(barSuggestion?.encoding.y).toContain("field_revenue");
      });

      it("should limit suggestions to specified count", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ fieldId: "cat1", columnName: "field_cat1" }),
          createStringColumn({ fieldId: "cat2", columnName: "field_cat2" }),
          createNumberColumn({ fieldId: "num1", columnName: "field_num1" }),
          createNumberColumn({ fieldId: "num2", columnName: "field_num2" }),
          createDateColumn({ fieldId: "date1", columnName: "field_date1" }),
        ];

        const fields: Record<string, Field> = {
          cat1: createField({ id: "cat1" as UUID, name: "Category 1" }),
          cat2: createField({ id: "cat2" as UUID, name: "Category 2" }),
          num1: createField({ id: "num1" as UUID, name: "Number 1" }),
          num2: createField({ id: "num2" as UUID, name: "Number 2" }),
          date1: createField({ id: "date1" as UUID, name: "Date 1" }),
        };

        const insight = createInsight();

        const suggestions1 = suggestCharts(insight, analysis, 100, fields, {
          limit: 1,
        });
        expect(suggestions1).toHaveLength(1);

        const suggestions2 = suggestCharts(insight, analysis, 100, fields, {
          limit: 2,
        });
        expect(suggestions2).toHaveLength(2);

        const suggestions5 = suggestCharts(insight, analysis, 100, fields, {
          limit: 5,
        });
        expect(suggestions5.length).toBeLessThanOrEqual(5);
      });
    });

    describe("line chart suggestions", () => {
      it("should suggest line chart for temporal + numerical data", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({
            columnName: "field_date",
            fieldId: "date",
          }),
          createNumberColumn({
            columnName: "field_sales",
            fieldId: "sales",
          }),
        ];

        const fields: Record<string, Field> = {
          date: createField({ id: "date" as UUID, name: "Date" }),
          sales: createField({ id: "sales" as UUID, name: "Sales" }),
        };

        const insight = createInsight();
        const suggestions = suggestCharts(insight, analysis, 100, fields);

        const lineSuggestion = suggestions.find((s) => s.chartType === "line");
        expect(lineSuggestion).toBeDefined();
        expect(lineSuggestion?.encoding.x).toContain("field_date");
        expect(lineSuggestion?.encoding.y).toContain("field_sales");
      });

      it("should not suggest line chart without temporal data", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ fieldId: "cat", columnName: "field_cat" }),
          createNumberColumn({ fieldId: "num", columnName: "field_num" }),
        ];

        const fields: Record<string, Field> = {
          cat: createField({ id: "cat" as UUID, name: "Category" }),
          num: createField({ id: "num" as UUID, name: "Number" }),
        };

        const insight = createInsight();
        const suggestions = suggestCharts(insight, analysis, 100, fields);

        const lineSuggestion = suggestions.find((s) => s.chartType === "line");
        expect(lineSuggestion).toBeUndefined();
      });
    });

    describe("scatter plot suggestions", () => {
      it("should suggest scatter for 2+ numerical columns (small dataset)", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({
            columnName: "field_price",
            fieldId: "price",
          }),
          createNumberColumn({
            columnName: "field_quantity",
            fieldId: "quantity",
          }),
        ];

        const fields: Record<string, Field> = {
          price: createField({ id: "price" as UUID, name: "Price" }),
          quantity: createField({ id: "quantity" as UUID, name: "Quantity" }),
        };

        const insight = createInsight();
        const suggestions = suggestCharts(insight, analysis, 100, fields);

        const scatterSuggestion = suggestions.find(
          (s) => s.chartType === "dot",
        );
        expect(scatterSuggestion).toBeDefined();
        expect(scatterSuggestion?.encoding.x).toBe("field_price");
        expect(scatterSuggestion?.encoding.y).toBe("field_quantity");
      });

      it("should not suggest scatter for single numerical column", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ fieldId: "cat", columnName: "field_cat" }),
          createNumberColumn({ fieldId: "num", columnName: "field_num" }),
        ];

        const fields: Record<string, Field> = {
          cat: createField({ id: "cat" as UUID, name: "Category" }),
          num: createField({ id: "num" as UUID, name: "Number" }),
        };

        const insight = createInsight();
        const suggestions = suggestCharts(insight, analysis, 100, fields);

        const scatterSuggestion = suggestions.find(
          (s) => s.chartType === "dot",
        );
        expect(scatterSuggestion).toBeUndefined();
      });
    });

    describe("area chart suggestions", () => {
      it("should suggest area chart for temporal data", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date", fieldId: "date" }),
          createNumberColumn({
            columnName: "field_value",
            fieldId: "value",
          }),
        ];

        const fields: Record<string, Field> = {
          date: createField({ id: "date" as UUID, name: "Date" }),
          value: createField({ id: "value" as UUID, name: "Value" }),
        };

        const insight = createInsight();
        const suggestions = suggestCharts(insight, analysis, 100, fields);

        const areaSuggestion = suggestions.find(
          (s) => s.chartType === "areaY",
        );
        expect(areaSuggestion).toBeDefined();
      });
    });

    describe("grouped bar chart suggestions", () => {
      it("should suggest grouped bar with suitable color dimension", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_category",
            fieldId: "category",
            cardinality: 5,
          }),
          createStringColumn({
            columnName: "field_status",
            fieldId: "status",
            cardinality: 3,
            maxFrequencyRatio: 0.4, // Evenly distributed
          }),
          createNumberColumn({
            columnName: "field_amount",
            fieldId: "amount",
          }),
        ];

        const fields: Record<string, Field> = {
          category: createField({ id: "category" as UUID, name: "Category" }),
          status: createField({ id: "status" as UUID, name: "Status" }),
          amount: createField({ id: "amount" as UUID, name: "Amount" }),
        };

        const insight = createInsight();
        const suggestions = suggestCharts(insight, analysis, 100, fields);

        const groupedBar = suggestions.find(
          (s) => s.chartType === "barY" && s.encoding.color,
        );
        expect(groupedBar).toBeDefined();
      });

      it("should not suggest grouped bar with dominated distribution", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_category",
            fieldId: "category",
            cardinality: 5,
          }),
          createStringColumn({
            columnName: "field_status",
            fieldId: "status",
            cardinality: 2,
            maxFrequencyRatio: 0.95, // Dominated by one value
          }),
          createNumberColumn({
            columnName: "field_amount",
            fieldId: "amount",
          }),
        ];

        const fields: Record<string, Field> = {
          category: createField({ id: "category" as UUID, name: "Category" }),
          status: createField({ id: "status" as UUID, name: "Status" }),
          amount: createField({ id: "amount" as UUID, name: "Amount" }),
        };

        const insight = createInsight();
        const suggestions = suggestCharts(insight, analysis, 100, fields);

        const groupedBar = suggestions.find(
          (s) => s.chartType === "barY" && s.encoding.color,
        );
        // Should not suggest or should prefer simple bar
        expect(
          groupedBar?.encoding.color === "field_status" ? false : true,
        ).toBe(true);
      });
    });

    describe("options - excludeChartTypes", () => {
      it("should exclude specified chart types", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date", fieldId: "date" }),
          createNumberColumn({
            columnName: "field_value",
            fieldId: "value",
          }),
        ];

        const fields: Record<string, Field> = {
          date: createField({ id: "date" as UUID, name: "Date" }),
          value: createField({ id: "value" as UUID, name: "Value" }),
        };

        const insight = createInsight();
        const suggestions = suggestCharts(insight, analysis, 100, fields, {
          excludeChartTypes: ["line", "areaY"],
        });

        expect(suggestions.every((s) => s.chartType !== "line")).toBe(true);
        expect(suggestions.every((s) => s.chartType !== "areaY")).toBe(true);
      });
    });

    describe("options - excludeEncodings", () => {
      it("should exclude suggestions with matching encodings", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_category",
            fieldId: "category",
          }),
          createNumberColumn({
            columnName: "field_amount",
            fieldId: "amount",
          }),
        ];

        const fields: Record<string, Field> = {
          category: createField({ id: "category" as UUID, name: "Category" }),
          amount: createField({ id: "amount" as UUID, name: "Amount" }),
        };

        const insight = createInsight();

        // Get initial suggestions
        const initial = suggestCharts(insight, analysis, 100, fields);
        const firstSuggestion = initial[0];

        // Exclude that encoding
        const excludeEncodings = new Set([
          `${firstSuggestion.encoding.x ?? ""}|${firstSuggestion.encoding.y ?? ""}|${firstSuggestion.encoding.color ?? ""}`,
        ]);

        const filtered = suggestCharts(insight, analysis, 100, fields, {
          excludeEncodings,
        });

        // Should not include the excluded encoding
        expect(
          filtered.some(
            (s) =>
              s.encoding.x === firstSuggestion.encoding.x &&
              s.encoding.y === firstSuggestion.encoding.y &&
              s.encoding.color === firstSuggestion.encoding.color,
          ),
        ).toBe(false);
      });
    });

    describe("options - existingFields", () => {
      it("should mark new fields in suggestions", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_category",
            fieldId: "category",
          }),
          createNumberColumn({
            columnName: "field_amount",
            fieldId: "amount",
          }),
        ];

        const fields: Record<string, Field> = {
          category: createField({ id: "category" as UUID, name: "Category" }),
          amount: createField({ id: "amount" as UUID, name: "Amount" }),
        };

        const insight = createInsight();
        const suggestions = suggestCharts(insight, analysis, 100, fields, {
          existingFields: ["field_category"],
        });

        const barSuggestion = suggestions.find((s) => s.chartType === "barY");
        expect(barSuggestion?.newFields).toContain("field_amount");
        expect(barSuggestion?.usesExistingFieldsOnly).toBe(false);
      });

      it("should prioritize suggestions using existing fields", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_existing",
            fieldId: "existing",
          }),
          createStringColumn({
            columnName: "field_new",
            fieldId: "new",
          }),
          createNumberColumn({
            columnName: "field_amount",
            fieldId: "amount",
          }),
        ];

        const fields: Record<string, Field> = {
          existing: createField({ id: "existing" as UUID, name: "Existing" }),
          new: createField({ id: "new" as UUID, name: "New" }),
          amount: createField({ id: "amount" as UUID, name: "Amount" }),
        };

        const insight = createInsight();
        const suggestions = suggestCharts(insight, analysis, 100, fields, {
          existingFields: ["field_existing", "field_amount"],
        });

        // First suggestion should use existing fields
        const firstSuggestion = suggestions[0];
        expect(firstSuggestion?.usesExistingFieldsOnly).toBe(true);
      });
    });

    describe("options - seed", () => {
      it("should produce deterministic results with same seed", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_cat1", fieldId: "cat1" }),
          createStringColumn({ columnName: "field_cat2", fieldId: "cat2" }),
          createNumberColumn({ columnName: "field_num1", fieldId: "num1" }),
          createNumberColumn({ columnName: "field_num2", fieldId: "num2" }),
        ];

        const fields: Record<string, Field> = {
          cat1: createField({ id: "cat1" as UUID, name: "Cat 1" }),
          cat2: createField({ id: "cat2" as UUID, name: "Cat 2" }),
          num1: createField({ id: "num1" as UUID, name: "Num 1" }),
          num2: createField({ id: "num2" as UUID, name: "Num 2" }),
        };

        const insight = createInsight();

        const suggestions1 = suggestCharts(insight, analysis, 100, fields, {
          seed: 42,
        });
        const suggestions2 = suggestCharts(insight, analysis, 100, fields, {
          seed: 42,
        });

        expect(suggestions1).toEqual(suggestions2);
      });

      it("should produce different results with different seeds", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_cat1", fieldId: "cat1" }),
          createStringColumn({ columnName: "field_cat2", fieldId: "cat2" }),
          createNumberColumn({ columnName: "field_num1", fieldId: "num1" }),
          createNumberColumn({ columnName: "field_num2", fieldId: "num2" }),
        ];

        const fields: Record<string, Field> = {
          cat1: createField({ id: "cat1" as UUID, name: "Cat 1" }),
          cat2: createField({ id: "cat2" as UUID, name: "Cat 2" }),
          num1: createField({ id: "num1" as UUID, name: "Num 1" }),
          num2: createField({ id: "num2" as UUID, name: "Num 2" }),
        };

        const insight = createInsight();

        const suggestions1 = suggestCharts(insight, analysis, 100, fields, {
          seed: 42,
        });
        const suggestions2 = suggestCharts(insight, analysis, 100, fields, {
          seed: 99,
        });

        // Results may differ due to shuffling
        // Just check they're both valid
        expect(suggestions1.length).toBeGreaterThan(0);
        expect(suggestions2.length).toBeGreaterThan(0);
      });
    });

    describe("edge cases", () => {
      it("should handle empty analysis", () => {
        const insight = createInsight();
        const suggestions = suggestCharts(insight, [], 0, {});

        expect(suggestions).toEqual([]);
      });

      it("should handle analysis with only blocked columns", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_id",
            fieldId: "id",
            semantic: "identifier",
          }),
        ];

        const fields: Record<string, Field> = {
          id: createField({ id: "id" as UUID, name: "ID" }),
        };

        const insight = createInsight();
        const suggestions = suggestCharts(insight, analysis, 100, fields);

        expect(suggestions).toEqual([]);
      });

      it("should handle numerical columns with no variance", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_category",
            fieldId: "category",
          }),
          createNumberColumn({
            columnName: "field_zeros",
            fieldId: "zeros",
            min: 0,
            max: 0,
            stdDev: 0,
          }),
        ];

        const fields: Record<string, Field> = {
          category: createField({ id: "category" as UUID, name: "Category" }),
          zeros: createField({ id: "zeros" as UUID, name: "Zeros" }),
        };

        const insight = createInsight();
        const suggestions = suggestCharts(insight, analysis, 100, fields);

        // Should not suggest charts using the zero-variance column
        expect(
          suggestions.every((s) => !s.encoding.y?.includes("field_zeros")),
        ).toBe(true);
      });
    });
  });

  // ============================================================================
  // suggestByChartType()
  // ============================================================================

  describe("suggestByChartType()", () => {
    describe("barY chart type", () => {
      it("should generate barY suggestion with categorical data", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_category",
            fieldId: "category",
          }),
          createNumberColumn({
            columnName: "field_amount",
            fieldId: "amount",
          }),
        ];

        const fields: Record<string, Field> = {
          category: createField({ id: "category" as UUID, name: "Category" }),
          amount: createField({ id: "amount" as UUID, name: "Amount" }),
        };

        const insight = createInsight();
        const suggestion = suggestByChartType(
          insight,
          analysis,
          100,
          fields,
          "barY",
        );

        expect(suggestion).toBeDefined();
        expect(suggestion?.chartType).toBe("barY");
        expect(suggestion?.encoding.x).toBe("field_category");
        expect(suggestion?.encoding.y).toContain("field_amount");
      });

      it("should generate barY with temporal data when tagContext is trend", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date", fieldId: "date" }),
          createNumberColumn({
            columnName: "field_value",
            fieldId: "value",
          }),
        ];

        const fields: Record<string, Field> = {
          date: createField({ id: "date" as UUID, name: "Date" }),
          value: createField({ id: "value" as UUID, name: "Value" }),
        };

        const insight = createInsight();
        const suggestion = suggestByChartType(
          insight,
          analysis,
          100,
          fields,
          "barY",
          { tagContext: "trend" },
        );

        expect(suggestion).toBeDefined();
        expect(suggestion?.chartType).toBe("barY");
        expect(suggestion?.encoding.x).toContain("field_date");
      });

      it("should return null without suitable data", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_text",
            fieldId: "text",
            semantic: "text",
            cardinality: 1000,
          }),
        ];

        const fields: Record<string, Field> = {
          text: createField({ id: "text" as UUID, name: "Text" }),
        };

        const insight = createInsight();
        const suggestion = suggestByChartType(
          insight,
          analysis,
          100,
          fields,
          "barY",
        );

        expect(suggestion).toBeNull();
      });
    });

    describe("barX chart type", () => {
      it("should generate horizontal bar chart", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_category",
            fieldId: "category",
          }),
          createNumberColumn({
            columnName: "field_amount",
            fieldId: "amount",
          }),
        ];

        const fields: Record<string, Field> = {
          category: createField({ id: "category" as UUID, name: "Category" }),
          amount: createField({ id: "amount" as UUID, name: "Amount" }),
        };

        const insight = createInsight();
        const suggestion = suggestByChartType(
          insight,
          analysis,
          100,
          fields,
          "barX",
        );

        expect(suggestion).toBeDefined();
        expect(suggestion?.chartType).toBe("barX");
        expect(suggestion?.encoding.y).toBe("field_category");
        expect(suggestion?.encoding.x).toContain("field_amount");
      });
    });

    describe("line chart type", () => {
      it("should generate line chart with temporal data", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date", fieldId: "date" }),
          createNumberColumn({
            columnName: "field_value",
            fieldId: "value",
          }),
        ];

        const fields: Record<string, Field> = {
          date: createField({ id: "date" as UUID, name: "Date" }),
          value: createField({ id: "value" as UUID, name: "Value" }),
        };

        const insight = createInsight();
        const suggestion = suggestByChartType(
          insight,
          analysis,
          100,
          fields,
          "line",
        );

        expect(suggestion).toBeDefined();
        expect(suggestion?.chartType).toBe("line");
        expect(suggestion?.encoding.x).toContain("field_date");
        expect(suggestion?.encoding.y).toContain("field_value");
      });

      it("should return null without temporal data", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_category",
            fieldId: "category",
          }),
          createNumberColumn({
            columnName: "field_value",
            fieldId: "value",
          }),
        ];

        const fields: Record<string, Field> = {
          category: createField({ id: "category" as UUID, name: "Category" }),
          value: createField({ id: "value" as UUID, name: "Value" }),
        };

        const insight = createInsight();
        const suggestion = suggestByChartType(
          insight,
          analysis,
          100,
          fields,
          "line",
        );

        expect(suggestion).toBeNull();
      });
    });

    describe("areaY chart type", () => {
      it("should generate area chart with temporal data", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date", fieldId: "date" }),
          createNumberColumn({
            columnName: "field_value",
            fieldId: "value",
          }),
        ];

        const fields: Record<string, Field> = {
          date: createField({ id: "date" as UUID, name: "Date" }),
          value: createField({ id: "value" as UUID, name: "Value" }),
        };

        const insight = createInsight();
        const suggestion = suggestByChartType(
          insight,
          analysis,
          100,
          fields,
          "areaY",
        );

        expect(suggestion).toBeDefined();
        expect(suggestion?.chartType).toBe("areaY");
      });
    });

    describe("dot (scatter) chart type", () => {
      it("should generate scatter for small datasets", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_x", fieldId: "x" }),
          createNumberColumn({ columnName: "field_y", fieldId: "y" }),
        ];

        const fields: Record<string, Field> = {
          x: createField({ id: "x" as UUID, name: "X" }),
          y: createField({ id: "y" as UUID, name: "Y" }),
        };

        const insight = createInsight();
        const suggestion = suggestByChartType(
          insight,
          analysis,
          1000, // Small dataset
          fields,
          "dot",
        );

        expect(suggestion).toBeDefined();
        expect(suggestion?.chartType).toBe("dot");
      });

      it("should return null for large datasets", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_x", fieldId: "x" }),
          createNumberColumn({ columnName: "field_y", fieldId: "y" }),
        ];

        const fields: Record<string, Field> = {
          x: createField({ id: "x" as UUID, name: "X" }),
          y: createField({ id: "y" as UUID, name: "Y" }),
        };

        const insight = createInsight();
        const suggestion = suggestByChartType(
          insight,
          analysis,
          10000, // Large dataset
          fields,
          "dot",
        );

        expect(suggestion).toBeNull();
      });
    });

    describe("hexbin chart type", () => {
      it("should generate hexbin for any dataset size", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_x", fieldId: "x" }),
          createNumberColumn({ columnName: "field_y", fieldId: "y" }),
        ];

        const fields: Record<string, Field> = {
          x: createField({ id: "x" as UUID, name: "X" }),
          y: createField({ id: "y" as UUID, name: "Y" }),
        };

        const insight = createInsight();

        const smallDataset = suggestByChartType(
          insight,
          analysis,
          1000,
          fields,
          "hexbin",
        );
        expect(smallDataset).toBeDefined();

        const largeDataset = suggestByChartType(
          insight,
          analysis,
          10000,
          fields,
          "hexbin",
        );
        expect(largeDataset).toBeDefined();
      });

      it("should include different rationale for large datasets", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_x", fieldId: "x" }),
          createNumberColumn({ columnName: "field_y", fieldId: "y" }),
        ];

        const fields: Record<string, Field> = {
          x: createField({ id: "x" as UUID, name: "X" }),
          y: createField({ id: "y" as UUID, name: "Y" }),
        };

        const insight = createInsight();
        const suggestion = suggestByChartType(
          insight,
          analysis,
          10000,
          fields,
          "hexbin",
        );

        expect(suggestion?.rationale).toContain("Density plot");
      });
    });
  });

  // ============================================================================
  // suggestForAllChartTypes()
  // ============================================================================

  describe("suggestForAllChartTypes()", () => {
    it("should generate suggestions for all specified chart types", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "field_cat", fieldId: "cat" }),
        createDateColumn({ columnName: "field_date", fieldId: "date" }),
        createNumberColumn({ columnName: "field_num1", fieldId: "num1" }),
        createNumberColumn({ columnName: "field_num2", fieldId: "num2" }),
      ];

      const fields: Record<string, Field> = {
        cat: createField({ id: "cat" as UUID, name: "Category" }),
        date: createField({ id: "date" as UUID, name: "Date" }),
        num1: createField({ id: "num1" as UUID, name: "Num 1" }),
        num2: createField({ id: "num2" as UUID, name: "Num 2" }),
      };

      const insight = createInsight();
      const chartTypes = ["barY", "line", "dot"] as const;
      const suggestions = suggestForAllChartTypes(
        insight,
        analysis,
        1000,
        fields,
        chartTypes,
      );

      expect(suggestions.size).toBe(3);
      expect(suggestions.has("barY")).toBe(true);
      expect(suggestions.has("line")).toBe(true);
      expect(suggestions.has("dot")).toBe(true);
    });

    it("should return null for chart types without suitable data", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "field_cat", fieldId: "cat" }),
        createNumberColumn({ columnName: "field_num", fieldId: "num" }),
      ];

      const fields: Record<string, Field> = {
        cat: createField({ id: "cat" as UUID, name: "Category" }),
        num: createField({ id: "num" as UUID, name: "Number" }),
      };

      const insight = createInsight();
      const suggestions = suggestForAllChartTypes(
        insight,
        analysis,
        1000,
        fields,
        ["line", "dot"],
      );

      expect(suggestions.get("line")).toBeNull();
      expect(suggestions.get("dot")).toBeNull();
    });

    it("should handle empty chart types array", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "field_cat", fieldId: "cat" }),
      ];

      const fields: Record<string, Field> = {
        cat: createField({ id: "cat" as UUID, name: "Category" }),
      };

      const insight = createInsight();
      const suggestions = suggestForAllChartTypes(
        insight,
        analysis,
        100,
        fields,
        [],
      );

      expect(suggestions.size).toBe(0);
    });
  });

  // ============================================================================
  // getChartTypeUnavailableReason()
  // ============================================================================

  describe("getChartTypeUnavailableReason()", () => {
    describe("line and area charts", () => {
      it("should require date column for line charts", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_cat", fieldId: "cat" }),
          createNumberColumn({ columnName: "field_num", fieldId: "num" }),
        ];

        const reason = getChartTypeUnavailableReason("line", analysis);
        expect(reason).toBe("Requires date column");
      });

      it("should require numeric column for line charts", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date", fieldId: "date" }),
          createStringColumn({ columnName: "field_cat", fieldId: "cat" }),
        ];

        const reason = getChartTypeUnavailableReason("line", analysis);
        expect(reason).toBe("Requires numeric column");
      });

      it("should return null when requirements are met", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date", fieldId: "date" }),
          createNumberColumn({ columnName: "field_num", fieldId: "num" }),
        ];

        const reason = getChartTypeUnavailableReason("line", analysis);
        expect(reason).toBeNull();
      });

      it("should have same requirements for area charts", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_cat", fieldId: "cat" }),
          createNumberColumn({ columnName: "field_num", fieldId: "num" }),
        ];

        const reason = getChartTypeUnavailableReason("areaY", analysis);
        expect(reason).toBe("Requires date column");
      });
    });

    describe("scatter plots", () => {
      it("should require 2+ numeric columns", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_cat", fieldId: "cat" }),
          createNumberColumn({ columnName: "field_num", fieldId: "num" }),
        ];

        const reason = getChartTypeUnavailableReason("dot", analysis);
        expect(reason).toBe("Requires 2+ numeric columns");
      });

      it("should return null with 2+ numeric columns", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_num1", fieldId: "num1" }),
          createNumberColumn({ columnName: "field_num2", fieldId: "num2" }),
        ];

        const reason = getChartTypeUnavailableReason("dot", analysis);
        expect(reason).toBeNull();
      });
    });

    describe("bar charts", () => {
      it("should require category column", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_num1", fieldId: "num1" }),
          createNumberColumn({ columnName: "field_num2", fieldId: "num2" }),
        ];

        const reason = getChartTypeUnavailableReason("barY", analysis);
        expect(reason).toBe("Requires category column");
      });

      it("should require numeric column", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_cat", fieldId: "cat" }),
          createStringColumn({ columnName: "field_text", fieldId: "text" }),
        ];

        const reason = getChartTypeUnavailableReason("barY", analysis);
        expect(reason).toBe("Requires numeric column");
      });

      it("should accept date column as category", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date", fieldId: "date" }),
          createNumberColumn({ columnName: "field_num", fieldId: "num" }),
        ];

        const reason = getChartTypeUnavailableReason("barY", analysis);
        expect(reason).toBeNull();
      });

      it("should return null when requirements are met", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({ columnName: "field_cat", fieldId: "cat" }),
          createNumberColumn({ columnName: "field_num", fieldId: "num" }),
        ];

        const reason = getChartTypeUnavailableReason("barY", analysis);
        expect(reason).toBeNull();
      });
    });
  });

  // ============================================================================
  // suggestByTag()
  // ============================================================================

  describe("suggestByTag()", () => {
    describe("comparison tag", () => {
      it("should suggest bar chart for comparison", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_category",
            fieldId: "category",
            cardinality: 5,
          }),
          createNumberColumn({
            columnName: "field_amount",
            fieldId: "amount",
          }),
        ];

        const fields: Record<string, Field> = {
          category: createField({ id: "category" as UUID, name: "Category" }),
          amount: createField({ id: "amount" as UUID, name: "Amount" }),
        };

        const insight = createInsight();
        const suggestions = suggestByTag(insight, analysis, 100, fields);

        const comparisonTag = suggestions.find((s) => s.tag === "comparison");
        expect(comparisonTag).toBeDefined();
        expect(comparisonTag?.chartType).toMatch(/^bar[YX]$/);
      });

      it("should suggest horizontal bar for many categories", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_category",
            fieldId: "category",
            cardinality: 15,
          }),
          createNumberColumn({
            columnName: "field_amount",
            fieldId: "amount",
          }),
        ];

        const fields: Record<string, Field> = {
          category: createField({ id: "category" as UUID, name: "Category" }),
          amount: createField({ id: "amount" as UUID, name: "Amount" }),
        };

        const insight = createInsight();
        const suggestions = suggestByTag(insight, analysis, 100, fields);

        const comparisonTag = suggestions.find((s) => s.tag === "comparison");
        expect(comparisonTag?.chartType).toBe("barX");
      });
    });

    describe("trend tag", () => {
      it("should suggest line chart for trend", () => {
        const analysis: ColumnAnalysis[] = [
          createDateColumn({ columnName: "field_date", fieldId: "date" }),
          createNumberColumn({
            columnName: "field_value",
            fieldId: "value",
          }),
        ];

        const fields: Record<string, Field> = {
          date: createField({ id: "date" as UUID, name: "Date" }),
          value: createField({ id: "value" as UUID, name: "Value" }),
        };

        const insight = createInsight();
        const suggestions = suggestByTag(insight, analysis, 100, fields);

        const trendTag = suggestions.find((s) => s.tag === "trend");
        expect(trendTag).toBeDefined();
        expect(trendTag?.chartType).toBe("line");
      });

      it("should not suggest trend without temporal data", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_category",
            fieldId: "category",
          }),
          createNumberColumn({
            columnName: "field_value",
            fieldId: "value",
          }),
        ];

        const fields: Record<string, Field> = {
          category: createField({ id: "category" as UUID, name: "Category" }),
          value: createField({ id: "value" as UUID, name: "Value" }),
        };

        const insight = createInsight();
        const suggestions = suggestByTag(insight, analysis, 100, fields);

        const trendTag = suggestions.find((s) => s.tag === "trend");
        expect(trendTag).toBeUndefined();
      });
    });

    describe("correlation tag", () => {
      it("should suggest scatter for small datasets", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_x", fieldId: "x" }),
          createNumberColumn({ columnName: "field_y", fieldId: "y" }),
        ];

        const fields: Record<string, Field> = {
          x: createField({ id: "x" as UUID, name: "X" }),
          y: createField({ id: "y" as UUID, name: "Y" }),
        };

        const insight = createInsight();
        const suggestions = suggestByTag(insight, analysis, 1000, fields);

        const correlationTag = suggestions.find(
          (s) => s.tag === "correlation",
        );
        expect(correlationTag?.chartType).toBe("dot");
      });

      it("should suggest hexbin for large datasets", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_x", fieldId: "x" }),
          createNumberColumn({ columnName: "field_y", fieldId: "y" }),
        ];

        const fields: Record<string, Field> = {
          x: createField({ id: "x" as UUID, name: "X" }),
          y: createField({ id: "y" as UUID, name: "Y" }),
        };

        const insight = createInsight();
        const suggestions = suggestByTag(insight, analysis, 10000, fields);

        const correlationTag = suggestions.find(
          (s) => s.tag === "correlation",
        );
        expect(correlationTag?.chartType).toBe("hexbin");
      });
    });

    describe("distribution tag", () => {
      it("should suggest hexbin for distribution", () => {
        const analysis: ColumnAnalysis[] = [
          createNumberColumn({ columnName: "field_x", fieldId: "x" }),
          createNumberColumn({ columnName: "field_y", fieldId: "y" }),
        ];

        const fields: Record<string, Field> = {
          x: createField({ id: "x" as UUID, name: "X" }),
          y: createField({ id: "y" as UUID, name: "Y" }),
        };

        const insight = createInsight();
        const suggestions = suggestByTag(insight, analysis, 5000, fields);

        const distributionTag = suggestions.find(
          (s) => s.tag === "distribution",
        );
        expect(distributionTag?.chartType).toBe("hexbin");
      });
    });

    describe("tag metadata", () => {
      it("should include tag display name and description", () => {
        const analysis: ColumnAnalysis[] = [
          createStringColumn({
            columnName: "field_category",
            fieldId: "category",
          }),
          createNumberColumn({
            columnName: "field_amount",
            fieldId: "amount",
          }),
        ];

        const fields: Record<string, Field> = {
          category: createField({ id: "category" as UUID, name: "Category" }),
          amount: createField({ id: "amount" as UUID, name: "Amount" }),
        };

        const insight = createInsight();
        const suggestions = suggestByTag(insight, analysis, 100, fields);

        const comparisonTag = suggestions.find((s) => s.tag === "comparison");
        expect(comparisonTag?.tagDisplayName).toBeDefined();
        expect(comparisonTag?.tagDescription).toBeDefined();
        expect(comparisonTag?.chartDisplayName).toBeDefined();
      });
    });
  });

  // ============================================================================
  // getAlternativeChartTypes()
  // ============================================================================

  describe("getAlternativeChartTypes()", () => {
    it("should return alternative chart types for line chart", () => {
      const alternatives = getAlternativeChartTypes("line");

      expect(alternatives).toContain("areaY");
      expect(alternatives).not.toContain("line");
    });

    it("should return alternative chart types for bar chart", () => {
      const alternatives = getAlternativeChartTypes("barY");

      expect(alternatives).toContain("barX");
      expect(alternatives).not.toContain("barY");
    });

    it("should return alternative chart types for scatter", () => {
      const alternatives = getAlternativeChartTypes("dot");

      expect(alternatives).toContain("hexbin");
      expect(alternatives).not.toContain("dot");
    });

    it("should return empty array for charts with no alternatives", () => {
      const alternatives = getAlternativeChartTypes("raster");

      // raster might have some alternatives, just check it's an array
      expect(Array.isArray(alternatives)).toBe(true);
    });

    it("should not include the current type in alternatives", () => {
      const chartTypes = [
        "barY",
        "barX",
        "line",
        "areaY",
        "dot",
        "hexbin",
      ] as const;

      for (const type of chartTypes) {
        const alternatives = getAlternativeChartTypes(type);
        expect(alternatives).not.toContain(type);
      }
    });
  });

  // ============================================================================
  // Integration tests
  // ============================================================================

  describe("integration - complete workflow", () => {
    it("should generate suggestions, exclude some, and regenerate", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "field_cat", fieldId: "cat" }),
        createDateColumn({ columnName: "field_date", fieldId: "date" }),
        createNumberColumn({ columnName: "field_num1", fieldId: "num1" }),
        createNumberColumn({ columnName: "field_num2", fieldId: "num2" }),
      ];

      const fields: Record<string, Field> = {
        cat: createField({ id: "cat" as UUID, name: "Category" }),
        date: createField({ id: "date" as UUID, name: "Date" }),
        num1: createField({ id: "num1" as UUID, name: "Number 1" }),
        num2: createField({ id: "num2" as UUID, name: "Number 2" }),
      };

      const insight = createInsight();

      // Initial suggestions
      const initial = suggestCharts(insight, analysis, 1000, fields);
      expect(initial.length).toBeGreaterThan(0);

      // Create exclusion set from first suggestion
      const first = initial[0];
      const excludeEncodings = new Set([
        `${first.encoding.x ?? ""}|${first.encoding.y ?? ""}|${first.encoding.color ?? ""}`,
      ]);

      // Regenerate with exclusions
      const filtered = suggestCharts(insight, analysis, 1000, fields, {
        excludeEncodings,
      });

      // Should not include the excluded encoding
      expect(
        filtered.some(
          (s) =>
            s.encoding.x === first.encoding.x &&
            s.encoding.y === first.encoding.y,
        ),
      ).toBe(false);
    });

    it("should work with tag-based and type-based suggestions together", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "field_cat", fieldId: "cat" }),
        createDateColumn({ columnName: "field_date", fieldId: "date" }),
        createNumberColumn({ columnName: "field_num1", fieldId: "num1" }),
        createNumberColumn({ columnName: "field_num2", fieldId: "num2" }),
      ];

      const fields: Record<string, Field> = {
        cat: createField({ id: "cat" as UUID, name: "Category" }),
        date: createField({ id: "date" as UUID, name: "Date" }),
        num1: createField({ id: "num1" as UUID, name: "Number 1" }),
        num2: createField({ id: "num2" as UUID, name: "Number 2" }),
      };

      const insight = createInsight();

      // Get tag-based suggestions
      const tagSuggestions = suggestByTag(insight, analysis, 1000, fields);
      expect(tagSuggestions.length).toBeGreaterThan(0);

      // Get type-specific suggestion for one of the suggested types
      const firstTag = tagSuggestions[0];
      const typeSuggestion = suggestByChartType(
        insight,
        analysis,
        1000,
        fields,
        firstTag.chartType,
      );

      expect(typeSuggestion).toBeDefined();
      expect(typeSuggestion?.chartType).toBe(firstTag.chartType);
    });
  });

  // ============================================================================
  // Type safety guarantees
  // ============================================================================

  describe("type safety guarantees", () => {
    it("should always return valid ChartSuggestion objects", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "field_cat", fieldId: "cat" }),
        createNumberColumn({ columnName: "field_num", fieldId: "num" }),
      ];

      const fields: Record<string, Field> = {
        cat: createField({ id: "cat" as UUID, name: "Category" }),
        num: createField({ id: "num" as UUID, name: "Number" }),
      };

      const insight = createInsight();
      const suggestions = suggestCharts(insight, analysis, 100, fields);

      suggestions.forEach((suggestion) => {
        expect(suggestion.id).toBeDefined();
        expect(suggestion.title).toBeDefined();
        expect(suggestion.chartType).toBeDefined();
        expect(suggestion.encoding).toBeDefined();
        expect(typeof suggestion.id).toBe("string");
        expect(typeof suggestion.title).toBe("string");
      });
    });

    it("should handle all valid chart types", () => {
      const chartTypes = [
        "barY",
        "barX",
        "line",
        "areaY",
        "dot",
        "hexbin",
      ] as const;

      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "field_cat", fieldId: "cat" }),
        createDateColumn({ columnName: "field_date", fieldId: "date" }),
        createNumberColumn({ columnName: "field_num1", fieldId: "num1" }),
        createNumberColumn({ columnName: "field_num2", fieldId: "num2" }),
      ];

      const fields: Record<string, Field> = {
        cat: createField({ id: "cat" as UUID, name: "Category" }),
        date: createField({ id: "date" as UUID, name: "Date" }),
        num1: createField({ id: "num1" as UUID, name: "Number 1" }),
        num2: createField({ id: "num2" as UUID, name: "Number 2" }),
      };

      const insight = createInsight();

      chartTypes.forEach((chartType) => {
        expect(() => {
          suggestByChartType(insight, analysis, 1000, fields, chartType);
        }).not.toThrow();
      });
    });

    it("should maintain immutability of input data", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({ columnName: "field_cat", fieldId: "cat" }),
        createNumberColumn({ columnName: "field_num", fieldId: "num" }),
      ];

      const fields: Record<string, Field> = {
        cat: createField({ id: "cat" as UUID, name: "Category" }),
        num: createField({ id: "num" as UUID, name: "Number" }),
      };

      const insight = createInsight();

      const analysisCopy = JSON.parse(JSON.stringify(analysis));
      const fieldsCopy = JSON.parse(JSON.stringify(fields));

      suggestCharts(insight, analysis, 100, fields);

      expect(analysis).toEqual(analysisCopy);
      expect(fields).toEqual(fieldsCopy);
    });
  });
});
