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
  // Line Chart Snapshots
  // ============================================================================

  describe("line chart suggestions", () => {
    it("should generate temporal X + numerical Y encoding", () => {
      // Classic time series: date on X-axis, numerical metric on Y-axis
      const analysis: ColumnAnalysis[] = [
        createDateColumn({
          columnName: "field_date",
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
          name: "Date",
          columnName: "date",
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
        chartType: "line",
        analysis,
        insight,
        fields,
        rowCount: 365,
      });

      // Snapshot should include temporal X-axis and numerical Y-axis
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate temporal X + numerical Y + color encoding (multiple series)", () => {
      // Multiple line series distinguished by color
      const analysis: ColumnAnalysis[] = [
        createDateColumn({
          columnName: "field_month",
          fieldId: "month_001",
          cardinality: 12,
        }),
        createNumberColumn({
          columnName: "field_sales",
          fieldId: "sales_001",
          min: 0,
          max: 100000,
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
          id: "month_001" as UUID,
          name: "Month",
          columnName: "month",
          dataType: "date",
        }),
        createField({
          id: "sales_001" as UUID,
          name: "Sales",
          columnName: "sales",
          dataType: "number",
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
            "month_001" as UUID,
            "sales_001" as UUID,
            "region_001" as UUID,
          ],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "line",
        analysis,
        insight,
        fields,
        rowCount: 48,
      });

      // Snapshot should include color encoding for multiple series
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate continuous numerical X + numerical Y encoding", () => {
      // Line chart with numerical X-axis (not temporal)
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({
          columnName: "field_temperature",
          fieldId: "temp_001",
          min: -10,
          max: 40,
        }),
        createNumberColumn({
          columnName: "field_efficiency",
          fieldId: "eff_001",
          min: 0,
          max: 100,
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "temp_001" as UUID,
          name: "Temperature",
          columnName: "temperature",
          dataType: "number",
        }),
        createField({
          id: "eff_001" as UUID,
          name: "Efficiency",
          columnName: "efficiency",
          dataType: "number",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: ["temp_001" as UUID, "eff_001" as UUID],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "line",
        analysis,
        insight,
        fields,
        rowCount: 50,
      });

      // Snapshot should use numerical X-axis
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate encoding with insight metrics", () => {
      // Line chart using aggregated metrics instead of raw columns
      const analysis: ColumnAnalysis[] = [
        createDateColumn({
          columnName: "field_order_date",
          fieldId: "date_001",
          cardinality: 365,
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
          id: "date_001" as UUID,
          name: "Order Date",
          columnName: "order_date",
          dataType: "date",
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
          selectedFields: ["date_001" as UUID],
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
            id: "metric_avg_qty" as UUID,
            name: "Average Quantity",
            sourceTable: "table123" as UUID,
            columnName: "quantity",
            aggregation: "avg",
          },
        ],
      });

      const suggestions = suggestByChartType({
        chartType: "line",
        analysis,
        insight,
        fields,
        rowCount: 365,
      });

      // Snapshot should use metric encodings (metric: prefix)
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate encoding with categorical X + numerical Y", () => {
      // Line chart with categorical X-axis (less common but valid)
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "field_category",
          fieldId: "cat_001",
          cardinality: 5,
          sampleValues: ["Q1", "Q2", "Q3", "Q4", "Q5"],
        }),
        createNumberColumn({
          columnName: "field_growth_rate",
          fieldId: "growth_001",
          min: -5,
          max: 15,
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "cat_001" as UUID,
          name: "Quarter",
          columnName: "quarter",
        }),
        createField({
          id: "growth_001" as UUID,
          name: "Growth Rate",
          columnName: "growth_rate",
          dataType: "number",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: ["cat_001" as UUID, "growth_001" as UUID],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "line",
        analysis,
        insight,
        fields,
        rowCount: 5,
      });

      // Snapshot should support categorical X-axis
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate encoding with date binning transforms", () => {
      // High-cardinality temporal data requiring date binning
      const analysis: ColumnAnalysis[] = [
        createDateColumn({
          columnName: "field_timestamp",
          fieldId: "ts_001",
          cardinality: 8760, // hourly data for a year
        }),
        createNumberColumn({
          columnName: "field_value",
          fieldId: "value_001",
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "ts_001" as UUID,
          name: "Timestamp",
          columnName: "timestamp",
          dataType: "date",
        }),
        createField({
          id: "value_001" as UUID,
          name: "Value",
          columnName: "value",
          dataType: "number",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: ["ts_001" as UUID, "value_001" as UUID],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "line",
        analysis,
        insight,
        fields,
        rowCount: 8760,
      });

      // Snapshot should include xTransform for date binning
      expect(suggestions[0]).toMatchSnapshot();
    });
  });

  // ============================================================================
  // Scatter Plot (Dot) Chart Snapshots
  // ============================================================================

  describe("dot (scatter plot) chart suggestions", () => {
    it("should generate numerical X + numerical Y encoding", () => {
      // Classic scatter plot: two numerical dimensions for correlation analysis
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({
          columnName: "field_price",
          fieldId: "price_001",
          min: 10,
          max: 500,
        }),
        createNumberColumn({
          columnName: "field_units_sold",
          fieldId: "units_001",
          min: 0,
          max: 1000,
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "price_001" as UUID,
          name: "Price",
          columnName: "price",
          dataType: "number",
        }),
        createField({
          id: "units_001" as UUID,
          name: "Units Sold",
          columnName: "units_sold",
          dataType: "number",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: ["price_001" as UUID, "units_001" as UUID],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "dot",
        analysis,
        insight,
        fields,
        rowCount: 100,
      });

      // Snapshot should include both X and Y numerical encodings
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate numerical X + numerical Y + color encoding (grouped scatter)", () => {
      // Scatter plot with categorical color for grouping points
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({
          columnName: "field_age",
          fieldId: "age_001",
          min: 18,
          max: 65,
        }),
        createNumberColumn({
          columnName: "field_income",
          fieldId: "income_001",
          min: 20000,
          max: 150000,
        }),
        createStringColumn({
          columnName: "field_education",
          fieldId: "edu_001",
          cardinality: 4,
          sampleValues: ["High School", "Bachelor", "Master", "PhD"],
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "age_001" as UUID,
          name: "Age",
          columnName: "age",
          dataType: "number",
        }),
        createField({
          id: "income_001" as UUID,
          name: "Income",
          columnName: "income",
          dataType: "number",
        }),
        createField({
          id: "edu_001" as UUID,
          name: "Education Level",
          columnName: "education",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: [
            "age_001" as UUID,
            "income_001" as UUID,
            "edu_001" as UUID,
          ],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "dot",
        analysis,
        insight,
        fields,
        rowCount: 500,
      });

      // Snapshot should include color encoding for categorical grouping
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate numerical X + numerical Y + size encoding (bubble chart)", () => {
      // Bubble chart: scatter plot with size encoding for a third dimension
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({
          columnName: "field_advertising_spend",
          fieldId: "adspend_001",
          min: 1000,
          max: 100000,
        }),
        createNumberColumn({
          columnName: "field_revenue",
          fieldId: "revenue_001",
          min: 5000,
          max: 500000,
        }),
        createNumberColumn({
          columnName: "field_customer_count",
          fieldId: "customers_001",
          min: 10,
          max: 5000,
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "adspend_001" as UUID,
          name: "Advertising Spend",
          columnName: "advertising_spend",
          dataType: "number",
        }),
        createField({
          id: "revenue_001" as UUID,
          name: "Revenue",
          columnName: "revenue",
          dataType: "number",
        }),
        createField({
          id: "customers_001" as UUID,
          name: "Customer Count",
          columnName: "customer_count",
          dataType: "number",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: [
            "adspend_001" as UUID,
            "revenue_001" as UUID,
            "customers_001" as UUID,
          ],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "dot",
        analysis,
        insight,
        fields,
        rowCount: 200,
        options: { limit: 3 },
      });

      // Snapshot should include size encoding for bubble chart effect
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate encoding with insight metrics", () => {
      // Scatter plot using aggregated metrics instead of raw columns
      const analysis: ColumnAnalysis[] = [
        createStringColumn({
          columnName: "field_product_category",
          fieldId: "cat_001",
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
        createNumberColumn({
          columnName: "field_cost",
          fieldId: "cost_001",
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "cat_001" as UUID,
          name: "Product Category",
          columnName: "product_category",
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
        createField({
          id: "cost_001" as UUID,
          name: "Cost",
          columnName: "cost",
          dataType: "number",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: ["cat_001" as UUID],
        },
        metrics: [
          {
            id: "metric_avg_price" as UUID,
            name: "Average Price",
            sourceTable: "table123" as UUID,
            columnName: "price",
            aggregation: "avg",
          },
          {
            id: "metric_total_qty" as UUID,
            name: "Total Quantity",
            sourceTable: "table123" as UUID,
            columnName: "quantity",
            aggregation: "sum",
          },
          {
            id: "metric_avg_cost" as UUID,
            name: "Average Cost",
            sourceTable: "table123" as UUID,
            columnName: "cost",
            aggregation: "avg",
          },
        ],
      });

      const suggestions = suggestByChartType({
        chartType: "dot",
        analysis,
        insight,
        fields,
        rowCount: 10,
      });

      // Snapshot should use metric encodings (metric: prefix)
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate encoding with integer coordinates", () => {
      // Scatter plot with integer-based numerical columns
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({
          columnName: "field_rating",
          fieldId: "rating_001",
          min: 1,
          max: 5,
          sampleValues: [1, 2, 3, 4, 5],
        }),
        createNumberColumn({
          columnName: "field_review_count",
          fieldId: "reviews_001",
          min: 0,
          max: 1000,
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "rating_001" as UUID,
          name: "Rating",
          columnName: "rating",
          dataType: "number",
        }),
        createField({
          id: "reviews_001" as UUID,
          name: "Review Count",
          columnName: "review_count",
          dataType: "number",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: ["rating_001" as UUID, "reviews_001" as UUID],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "dot",
        analysis,
        insight,
        fields,
        rowCount: 250,
      });

      // Snapshot should handle integer-based coordinates
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate encoding for small dataset (correlation analysis)", () => {
      // Scatter plot suitable for correlation analysis with small dataset
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({
          columnName: "field_study_hours",
          fieldId: "hours_001",
          min: 0,
          max: 10,
        }),
        createNumberColumn({
          columnName: "field_test_score",
          fieldId: "score_001",
          min: 0,
          max: 100,
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "hours_001" as UUID,
          name: "Study Hours",
          columnName: "study_hours",
          dataType: "number",
        }),
        createField({
          id: "score_001" as UUID,
          name: "Test Score",
          columnName: "test_score",
          dataType: "number",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: ["hours_001" as UUID, "score_001" as UUID],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "dot",
        analysis,
        insight,
        fields,
        rowCount: 50, // Small dataset for correlation
      });

      // Snapshot should be suitable for correlation analysis
      expect(suggestions[0]).toMatchSnapshot();
    });

    it("should generate encoding with numerical X + numerical Y + color + size (full bubble chart)", () => {
      // Full bubble chart with all encodings: X, Y, color, and size
      const analysis: ColumnAnalysis[] = [
        createNumberColumn({
          columnName: "field_gdp_per_capita",
          fieldId: "gdp_001",
          min: 1000,
          max: 80000,
        }),
        createNumberColumn({
          columnName: "field_life_expectancy",
          fieldId: "life_001",
          min: 50,
          max: 85,
        }),
        createNumberColumn({
          columnName: "field_population",
          fieldId: "pop_001",
          min: 100000,
          max: 1400000000,
        }),
        createStringColumn({
          columnName: "field_continent",
          fieldId: "continent_001",
          cardinality: 6,
          sampleValues: [
            "Africa",
            "Asia",
            "Europe",
            "North America",
            "South America",
            "Oceania",
          ],
        }),
      ];

      const fields: Field[] = [
        createField({
          id: "gdp_001" as UUID,
          name: "GDP per Capita",
          columnName: "gdp_per_capita",
          dataType: "number",
        }),
        createField({
          id: "life_001" as UUID,
          name: "Life Expectancy",
          columnName: "life_expectancy",
          dataType: "number",
        }),
        createField({
          id: "pop_001" as UUID,
          name: "Population",
          columnName: "population",
          dataType: "number",
        }),
        createField({
          id: "continent_001" as UUID,
          name: "Continent",
          columnName: "continent",
        }),
      ];

      const insight = createInsight({
        baseTable: {
          tableId: "table123" as UUID,
          selectedFields: [
            "gdp_001" as UUID,
            "life_001" as UUID,
            "pop_001" as UUID,
            "continent_001" as UUID,
          ],
        },
        metrics: [],
      });

      const suggestions = suggestByChartType({
        chartType: "dot",
        analysis,
        insight,
        fields,
        rowCount: 180,
        options: { limit: 3 },
      });

      // Snapshot should include all four encodings (x, y, color, size)
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
