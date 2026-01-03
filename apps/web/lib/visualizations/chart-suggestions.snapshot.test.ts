/**
 * Snapshot tests for chart suggestions
 *
 * These tests capture the full chart configuration (type + encoding)
 * that gets generated for different data scenarios. While Vega-Lite specs
 * are deprecated (always {}), the encoding-driven suggestions are what
 * actually determine chart rendering.
 *
 * Snapshots help catch regressions in:
 * - Chart type selection
 * - Encoding generation (x, y, color, size)
 * - Transform selection (date binning)
 * - Axis type inference
 * - Label generation
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
import { suggestByChartType } from "./suggest-charts";

describe("chart-suggestions snapshots", () => {
  // ============================================================================
  // Mock Data Helpers
  // ============================================================================

  const createStringColumn = (
    overrides: Partial<StringAnalysis> = {},
  ): StringAnalysis => ({
    columnName: "field_category",
    dataType: "string",
    semantic: "categorical",
    cardinality: 5,
    uniqueness: 0.5,
    nullCount: 0,
    sampleValues: ["Electronics", "Books", "Clothing", "Food", "Toys"],
    fieldId: "field_cat_123",
    ...overrides,
  });

  const createNumberColumn = (
    overrides: Partial<NumberAnalysis> = {},
  ): NumberAnalysis => ({
    columnName: "field_sales",
    dataType: "number",
    semantic: "numerical",
    cardinality: 100,
    uniqueness: 0.9,
    nullCount: 0,
    sampleValues: [100, 250, 175, 300, 425],
    min: 0,
    max: 1000,
    stdDev: 150,
    zeroCount: 0,
    fieldId: "field_sales_456",
    ...overrides,
  });

  const createDateColumn = (
    overrides: Partial<DateAnalysis> = {},
  ): DateAnalysis => {
    const now = Date.now();
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
    return {
      columnName: "field_date",
      dataType: "date",
      semantic: "temporal",
      cardinality: 365,
      uniqueness: 0.8,
      nullCount: 0,
      sampleValues: [oneYearAgo, now],
      minDate: oneYearAgo,
      maxDate: now,
      fieldId: "field_date_789",
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
  // Bar Chart (barY) Snapshots
  // ============================================================================

  describe("barY (vertical bar) chart suggestions", () => {
    it("should generate categorical X + numerical Y encoding", () => {
      // Categorical dimension on X-axis, numerical metric on Y-axis
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "field_category",
          fieldId: "cat_001",
          cardinality: 5,
          sampleValues: ["Electronics", "Books", "Clothing", "Food", "Toys"],
        }),
        createNumberColumn({
          columnName: "field_sales",
          fieldId: "sales_001",
          min: 0,
          max: 10000,
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "cat_001" as UUID,
          name: "Category",
          columnName: "category",
        }),
        createField({
          id: "sales_001" as UUID,
          name: "Sales",
          columnName: "sales",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: ["cat_001" as UUID, "sales_001" as UUID],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "barY",
        analysis,
        insight,
        fields,
        rowCount: 5,
      });

      // Snapshot the first suggestion
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate temporal X + numerical Y encoding", () => {
      // Temporal dimension on X-axis with date binning, numerical metric on Y-axis
      const analysis: ColumnAnalysis[] = [
        createDateColumn({
          columnName: "field_order_date",
          fieldId: "date_001",
          cardinality: 365,
        }),
        createNumberColumn({
          columnName: "field_revenue",
          fieldId: "revenue_001",
          min: 0,
          max: 50000,
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "date_001" as UUID,
          name: "Order Date",
          columnName: "order_date",
          dataType: "date",
        }),
        createField({
          id: "revenue_001" as UUID,
          name: "Revenue",
          columnName: "revenue",
          dataType: "number",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: ["date_001" as UUID, "revenue_001" as UUID],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "barY",
        analysis,
        insight,
        fields,
        rowCount: 365,
      });

      // Snapshot should include xTransform for date binning
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate categorical X + numerical Y + color encoding (grouped bar)", () => {
      // Categorical X, numerical Y, categorical color for grouped bars
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "field_category",
          fieldId: "cat_001",
          cardinality: 5,
          sampleValues: ["Electronics", "Books", "Clothing", "Food", "Toys"],
        }),
        createNumberColumn({
          columnName: "field_sales",
          fieldId: "sales_001",
          min: 0,
          max: 10000,
        }),
        createStringColumn({
          columnName: "field_region",
          fieldId: "region_001",
          cardinality: 4,
          sampleValues: ["North", "South", "East", "West"],
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "cat_001" as UUID,
          name: "Category",
          columnName: "category",
        }),
        createField({
          id: "sales_001" as UUID,
          name: "Sales",
          columnName: "sales",
        }),
        createField({
          id: "region_001" as UUID,
          name: "Region",
          columnName: "region",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: [
            "cat_001" as UUID,
            "sales_001" as UUID,
            "region_001" as UUID,
          ],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "barY",
        analysis,
        insight,
        fields,
        rowCount: 20,
        options: { limit: 3 },
      });

      // Snapshot should include color encoding
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate encoding with insight metrics", () => {
      // Using insight-defined metrics instead of raw columns
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "field_product_name",
          fieldId: "product_001",
          cardinality: 10,
        }),
        createNumberColumn({
          columnName: "field_quantity",
          fieldId: "qty_001",
        }),
        createNumberColumn({
          columnName: "field_price",
          fieldId: "price_001",
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "product_001" as UUID,
          name: "Product Name",
          columnName: "product_name",
        }),
        createField({
          id: "qty_001" as UUID,
          name: "Quantity",
          columnName: "quantity",
          dataType: "number",
        }),
        createField({
          id: "price_001" as UUID,
          name: "Price",
          columnName: "price",
          dataType: "number",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: ["product_001" as UUID],
        },
        metrics: [
          {
            id: "metric_total_revenue" as UUID,
            name: "Total Revenue",
            sourceTable: "table123" as UUID,
            columnName: "price",
            aggregation: "sum",
          },
          {
            id: "metric_total_qty" as UUID,
            name: "Total Quantity",
            sourceTable: "table123" as UUID,
            columnName: "quantity",
            aggregation: "sum",
          },
        ],
      });

      const suggestions = suggestByChartType({
        chartType: "barY",
        analysis,
        insight,
        fields,
        rowCount: 10,
      });

      // Snapshot should use metric encodings (metric: prefix)
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate encoding with high-cardinality categorical X", () => {
      // Many categories on X-axis - should still suggest but might warn
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "field_customer_id",
          fieldId: "customer_001",
          cardinality: 150,
          uniqueness: 1.0,
        }),
        createNumberColumn({
          columnName: "field_order_total",
          fieldId: "total_001",
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "customer_001" as UUID,
          name: "Customer ID",
          columnName: "customer_id",
        }),
        createField({
          id: "total_001" as UUID,
          name: "Order Total",
          columnName: "order_total",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: ["customer_001" as UUID, "total_001" as UUID],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "barY",
        analysis,
        insight,
        fields,
        rowCount: 150,
      });

      // Snapshot should still generate valid encoding
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate encoding with boolean categorical X", () => {
      // Boolean field as categorical dimension
      const analysis: ColumnAnalysis[] = [
        {
          columnName: "field_is_premium",
          dataType: "boolean",
          semantic: "categorical",
          cardinality: 2,
          uniqueness: 0.5,
          nullCount: 0,
          sampleValues: [true, false],
          trueCount: 50,
          falseCount: 50,
          fieldId: "premium_001",
        },
        createNumberColumn({
          columnName: "field_revenue",
          fieldId: "revenue_001",
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "premium_001" as UUID,
          name: "Is Premium",
          columnName: "is_premium",
          dataType: "boolean",
        }),
        createField({
          id: "revenue_001" as UUID,
          name: "Revenue",
          columnName: "revenue",
          dataType: "number",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: ["premium_001" as UUID, "revenue_001" as UUID],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "barY",
        analysis,
        insight,
        fields,
        rowCount: 100,
      });

      // Snapshot should treat boolean as categorical
      expect(suggestions[0]).toMatchSnapshot();
    });
  });

  // ============================================================================
  // Horizontal Bar Chart (barX) Snapshots
  // ============================================================================

  describe("barX (horizontal bar) chart suggestions", () => {
    it("should generate numerical X + categorical Y encoding", () => {
      // Horizontal bars: numerical values on X, categories on Y
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "field_department",
          fieldId: "dept_001",
          cardinality: 8,
          sampleValues: ["Sales", "Marketing", "Engineering", "Support"],
        }),
        createNumberColumn({
          columnName: "field_headcount",
          fieldId: "count_001",
          min: 5,
          max: 50,
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "dept_001" as UUID,
          name: "Department",
          columnName: "department",
        }),
        createField({
          id: "count_001" as UUID,
          name: "Headcount",
          columnName: "headcount",
          dataType: "number",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: ["dept_001" as UUID, "count_001" as UUID],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "barX",
        analysis,
        insight,
        fields,
        rowCount: 8,
      });

      // Snapshot should swap X and Y compared to barY
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate numerical X + categorical Y + color encoding", () => {
      // Horizontal grouped bars with color encoding
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "field_product",
          fieldId: "product_001",
          cardinality: 5,
        }),
        createNumberColumn({
          columnName: "field_units_sold",
          fieldId: "units_001",
        }),
        createStringColumn({
          columnName: "field_quarter",
          fieldId: "quarter_001",
          cardinality: 4,
          sampleValues: ["Q1", "Q2", "Q3", "Q4"],
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "product_001" as UUID,
          name: "Product",
          columnName: "product",
        }),
        createField({
          id: "units_001" as UUID,
          name: "Units Sold",
          columnName: "units_sold",
          dataType: "number",
        }),
        createField({
          id: "quarter_001" as UUID,
          name: "Quarter",
          columnName: "quarter",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: [
            "product_001" as UUID,
            "units_001" as UUID,
            "quarter_001" as UUID,
          ],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "barX",
        analysis,
        insight,
        fields,
        rowCount: 20,
      });

      // Snapshot should include color encoding
      expect(suggestions[0]).toMatchSnapshot();
    });
  });

  // ============================================================================
  // Edge Cases and Empty States
  // ============================================================================

  describe("edge cases", () => {
    it("should handle empty analysis gracefully", () => {
      const suggestions = suggestByChartType({
        chartType: "barY",
        analysis: [],
        insight: createInsight(),
        fields: [],
        rowCount: 0,
      });

      // Should return empty array
      expect(suggestions).toMatchSnapshot();
    });

    it("should handle single column (no valid encoding)", () => {
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "field_only",
          fieldId: "only_001",
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "only_001" as UUID,
          name: "Only Field",
          columnName: "only_field",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: ["only_001" as UUID],
        },
      });

      const suggestions = suggestByChartType({
        chartType: "barY",
        analysis,
        insight,
        fields,
        rowCount: 10,
      });

      // Should return empty or minimal suggestions
      expect(suggestions).toMatchSnapshot();
    });
  });
});
