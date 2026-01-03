/**
 * Unit tests for compute-preview module
 *
 * Tests cover:
 * - computeInsightPreview() - Preview computation with implicit GROUP BY logic
 *   - Grand total aggregation (no grouping fields)
 *   - Single field grouping with metrics
 *   - Multiple field grouping with metrics
 *   - All metric types (count, count_distinct, sum, avg, min, max)
 *   - Preview limiting (maxRows parameter)
 *   - Null value handling in grouping and aggregations
 *   - Edge cases (empty data, no metrics, no fields)
 * - computeInsightDataFrame() - Full DataFrame computation without sampling
 * - Type safety and immutability guarantees
 */
import { describe, expect, it } from "vitest";
import type {
  DataFrameData,
  DataTable,
  Field,
  Insight,
  InsightMetric,
  UUID,
} from "@dashframe/types";
import {
  computeInsightPreview,
  computeInsightDataFrame,
  type PreviewResult,
} from "./compute-preview";

describe("compute-preview", () => {
  // ============================================================================
  // Mock Data Helpers
  // ============================================================================

  const createField = (overrides: Partial<Field> = {}): Field => ({
    id: "field123" as UUID,
    name: "field_name",
    type: "string",
    columnName: "field_name",
    ...overrides,
  });

  const createMetric = (
    overrides: Partial<InsightMetric> = {},
  ): InsightMetric => ({
    id: "metric123" as UUID,
    name: "count",
    aggregation: "count",
    ...overrides,
  });

  const createDataTable = (
    id: string,
    name: string,
    fields: Field[],
    overrides: Partial<DataTable> = {},
  ): DataTable => ({
    id: id as UUID,
    name,
    fields,
    source: {
      type: "csv",
      config: {},
    },
    createdAt: Date.now(),
    ...overrides,
  });

  const createInsight = (overrides: Partial<Insight> = {}): Insight => ({
    id: "insight123" as UUID,
    name: "Test Insight",
    baseTableId: "table1" as UUID,
    selectedFields: [],
    metrics: [],
    createdAt: Date.now(),
    ...overrides,
  });

  const createDataFrame = (
    columns: { name: string; type: string }[],
    rows: Record<string, unknown>[],
  ): DataFrameData => ({
    columns,
    rows,
  });

  // ============================================================================
  // computeInsightPreview() - Grand Total Aggregation (No Grouping)
  // ============================================================================

  describe("computeInsightPreview() - grand total aggregation", () => {
    it("should compute grand total when no grouping fields are selected", () => {
      const salesField = createField({
        id: "f1" as UUID,
        name: "sales",
        columnName: "sales",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Sales", [salesField]);
      const insight = createInsight({
        selectedFields: [], // No grouping
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "total_sales",
            aggregation: "sum",
            columnName: "sales",
          }),
          createMetric({
            id: "m2" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "sales", type: "number" }],
        [{ sales: 100 }, { sales: 200 }, { sales: 300 }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(1);
      expect(result.sampleSize).toBe(1);
      expect(result.dataFrame.rows).toHaveLength(1);
      expect(result.dataFrame.rows[0]).toEqual({
        total_sales: 600,
        count: 3,
      });
    });

    it("should compute grand total with count metric only", () => {
      const dataTable = createDataTable("table1", "Orders", []);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "row_count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "order_id", type: "string" }],
        [{ order_id: "1" }, { order_id: "2" }, { order_id: "3" }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(1);
      expect(result.dataFrame.rows[0]).toEqual({ row_count: 3 });
    });

    it("should compute grand total with multiple aggregations", () => {
      const priceField = createField({
        id: "f1" as UUID,
        name: "price",
        columnName: "price",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Products", [priceField]);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "total_price",
            aggregation: "sum",
            columnName: "price",
          }),
          createMetric({
            id: "m2" as UUID,
            name: "avg_price",
            aggregation: "avg",
            columnName: "price",
          }),
          createMetric({
            id: "m3" as UUID,
            name: "min_price",
            aggregation: "min",
            columnName: "price",
          }),
          createMetric({
            id: "m4" as UUID,
            name: "max_price",
            aggregation: "max",
            columnName: "price",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "price", type: "number" }],
        [{ price: 10 }, { price: 20 }, { price: 30 }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0]).toEqual({
        total_price: 60,
        avg_price: 20,
        min_price: 10,
        max_price: 30,
      });
    });

    it("should return empty result when no data rows", () => {
      const dataTable = createDataTable("table1", "Empty", []);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame([], []);

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(1);
      expect(result.dataFrame.rows[0]).toEqual({ count: 0 });
    });
  });

  // ============================================================================
  // computeInsightPreview() - Single Field Grouping
  // ============================================================================

  describe("computeInsightPreview() - single field grouping", () => {
    it("should group by single categorical field", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const salesField = createField({
        id: "f2" as UUID,
        name: "sales",
        columnName: "sales",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Sales", [
        categoryField,
        salesField,
      ]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID], // Group by category
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "total_sales",
            aggregation: "sum",
            columnName: "sales",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [
          { name: "category", type: "string" },
          { name: "sales", type: "number" },
        ],
        [
          { category: "Electronics", sales: 100 },
          { category: "Books", sales: 50 },
          { category: "Electronics", sales: 150 },
          { category: "Books", sales: 30 },
        ],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(2);
      expect(result.sampleSize).toBe(2);
      expect(result.dataFrame.rows).toHaveLength(2);

      // Should have one row per category
      const electronicsRow = result.dataFrame.rows.find(
        (r) => r.category === "Electronics",
      );
      const booksRow = result.dataFrame.rows.find((r) => r.category === "Books");

      expect(electronicsRow).toEqual({
        category: "Electronics",
        total_sales: 250,
      });
      expect(booksRow).toEqual({ category: "Books", total_sales: 80 });
    });

    it("should group by date field", () => {
      const dateField = createField({
        id: "f1" as UUID,
        name: "date",
        columnName: "date",
        type: "date",
      });
      const revenueField = createField({
        id: "f2" as UUID,
        name: "revenue",
        columnName: "revenue",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Revenue", [
        dateField,
        revenueField,
      ]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "total_revenue",
            aggregation: "sum",
            columnName: "revenue",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [
          { name: "date", type: "date" },
          { name: "revenue", type: "number" },
        ],
        [
          { date: "2024-01-01", revenue: 1000 },
          { date: "2024-01-01", revenue: 500 },
          { date: "2024-01-02", revenue: 750 },
        ],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(2);
      const jan1Row = result.dataFrame.rows.find((r) => r.date === "2024-01-01");
      const jan2Row = result.dataFrame.rows.find((r) => r.date === "2024-01-02");

      expect(jan1Row).toEqual({ date: "2024-01-01", total_revenue: 1500 });
      expect(jan2Row).toEqual({ date: "2024-01-02", total_revenue: 750 });
    });

    it("should handle null values in grouping field", () => {
      const statusField = createField({
        id: "f1" as UUID,
        name: "status",
        columnName: "status",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Orders", [statusField]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "status", type: "string" }],
        [
          { status: "completed" },
          { status: null },
          { status: "completed" },
          { status: null },
        ],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(2);
      const completedRow = result.dataFrame.rows.find(
        (r) => r.status === "completed",
      );
      const nullRow = result.dataFrame.rows.find((r) => r.status === null);

      expect(completedRow).toEqual({ status: "completed", count: 2 });
      expect(nullRow).toEqual({ status: null, count: 2 });
    });
  });

  // ============================================================================
  // computeInsightPreview() - Multiple Field Grouping
  // ============================================================================

  describe("computeInsightPreview() - multiple field grouping", () => {
    it("should group by two fields", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const regionField = createField({
        id: "f2" as UUID,
        name: "region",
        columnName: "region",
        type: "string",
      });
      const salesField = createField({
        id: "f3" as UUID,
        name: "sales",
        columnName: "sales",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Sales", [
        categoryField,
        regionField,
        salesField,
      ]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID, "f2" as UUID], // Group by category and region
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "total_sales",
            aggregation: "sum",
            columnName: "sales",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [
          { name: "category", type: "string" },
          { name: "region", type: "string" },
          { name: "sales", type: "number" },
        ],
        [
          { category: "Electronics", region: "North", sales: 100 },
          { category: "Electronics", region: "South", sales: 150 },
          { category: "Books", region: "North", sales: 50 },
          { category: "Electronics", region: "North", sales: 75 },
        ],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(3);

      const electronicsNorth = result.dataFrame.rows.find(
        (r) => r.category === "Electronics" && r.region === "North",
      );
      const electronicsSouth = result.dataFrame.rows.find(
        (r) => r.category === "Electronics" && r.region === "South",
      );
      const booksNorth = result.dataFrame.rows.find(
        (r) => r.category === "Books" && r.region === "North",
      );

      expect(electronicsNorth).toEqual({
        category: "Electronics",
        region: "North",
        total_sales: 175,
      });
      expect(electronicsSouth).toEqual({
        category: "Electronics",
        region: "South",
        total_sales: 150,
      });
      expect(booksNorth).toEqual({
        category: "Books",
        region: "North",
        total_sales: 50,
      });
    });

    it("should group by three fields", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const regionField = createField({
        id: "f2" as UUID,
        name: "region",
        columnName: "region",
        type: "string",
      });
      const yearField = createField({
        id: "f3" as UUID,
        name: "year",
        columnName: "year",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Sales", [
        categoryField,
        regionField,
        yearField,
      ]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID, "f2" as UUID, "f3" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [
          { name: "category", type: "string" },
          { name: "region", type: "string" },
          { name: "year", type: "number" },
        ],
        [
          { category: "A", region: "North", year: 2023 },
          { category: "A", region: "North", year: 2023 },
          { category: "A", region: "North", year: 2024 },
          { category: "A", region: "South", year: 2023 },
        ],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(3);

      const row1 = result.dataFrame.rows.find(
        (r) => r.category === "A" && r.region === "North" && r.year === 2023,
      );
      const row2 = result.dataFrame.rows.find(
        (r) => r.category === "A" && r.region === "North" && r.year === 2024,
      );
      const row3 = result.dataFrame.rows.find(
        (r) => r.category === "A" && r.region === "South" && r.year === 2023,
      );

      expect(row1).toEqual({
        category: "A",
        region: "North",
        year: 2023,
        count: 2,
      });
      expect(row2).toEqual({
        category: "A",
        region: "North",
        year: 2024,
        count: 1,
      });
      expect(row3).toEqual({
        category: "A",
        region: "South",
        year: 2023,
        count: 1,
      });
    });

    it("should handle null values in multiple grouping fields", () => {
      const field1 = createField({
        id: "f1" as UUID,
        name: "field1",
        columnName: "field1",
        type: "string",
      });
      const field2 = createField({
        id: "f2" as UUID,
        name: "field2",
        columnName: "field2",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Data", [field1, field2]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID, "f2" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [
          { name: "field1", type: "string" },
          { name: "field2", type: "string" },
        ],
        [
          { field1: "A", field2: "X" },
          { field1: "A", field2: null },
          { field1: null, field2: "X" },
          { field1: "A", field2: "X" },
        ],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(3);

      const rowAX = result.dataFrame.rows.find(
        (r) => r.field1 === "A" && r.field2 === "X",
      );
      const rowANull = result.dataFrame.rows.find(
        (r) => r.field1 === "A" && r.field2 === null,
      );
      const rowNullX = result.dataFrame.rows.find(
        (r) => r.field1 === null && r.field2 === "X",
      );

      expect(rowAX).toEqual({ field1: "A", field2: "X", count: 2 });
      expect(rowANull).toEqual({ field1: "A", field2: null, count: 1 });
      expect(rowNullX).toEqual({ field1: null, field2: "X", count: 1 });
    });
  });

  // ============================================================================
  // computeInsightPreview() - Metric Aggregations
  // ============================================================================

  describe("computeInsightPreview() - metric aggregations", () => {
    it("should compute count aggregation", () => {
      const dataTable = createDataTable("table1", "Orders", []);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "total_orders",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "order_id", type: "string" }],
        [{ order_id: "1" }, { order_id: "2" }, { order_id: "3" }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].total_orders).toBe(3);
    });

    it("should compute sum aggregation", () => {
      const revenueField = createField({
        id: "f1" as UUID,
        name: "revenue",
        columnName: "revenue",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Sales", [revenueField]);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "total_revenue",
            aggregation: "sum",
            columnName: "revenue",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "revenue", type: "number" }],
        [{ revenue: 100 }, { revenue: 200 }, { revenue: 50 }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].total_revenue).toBe(350);
    });

    it("should compute avg aggregation", () => {
      const priceField = createField({
        id: "f1" as UUID,
        name: "price",
        columnName: "price",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Products", [priceField]);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "avg_price",
            aggregation: "avg",
            columnName: "price",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "price", type: "number" }],
        [{ price: 10 }, { price: 20 }, { price: 30 }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].avg_price).toBe(20);
    });

    it("should compute min aggregation", () => {
      const temperatureField = createField({
        id: "f1" as UUID,
        name: "temperature",
        columnName: "temperature",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Weather", [temperatureField]);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "min_temp",
            aggregation: "min",
            columnName: "temperature",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "temperature", type: "number" }],
        [{ temperature: 15 }, { temperature: 5 }, { temperature: 25 }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].min_temp).toBe(5);
    });

    it("should compute max aggregation", () => {
      const scoreField = createField({
        id: "f1" as UUID,
        name: "score",
        columnName: "score",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Scores", [scoreField]);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "max_score",
            aggregation: "max",
            columnName: "score",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "score", type: "number" }],
        [{ score: 85 }, { score: 92 }, { score: 78 }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].max_score).toBe(92);
    });

    it("should compute count_distinct aggregation", () => {
      const cityField = createField({
        id: "f1" as UUID,
        name: "city",
        columnName: "city",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Customers", [cityField]);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "unique_cities",
            aggregation: "count_distinct",
            columnName: "city",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "city", type: "string" }],
        [
          { city: "New York" },
          { city: "Boston" },
          { city: "New York" },
          { city: "Chicago" },
          { city: "Boston" },
        ],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].unique_cities).toBe(3); // NY, Boston, Chicago
    });

    it("should handle null values in sum aggregation", () => {
      const amountField = createField({
        id: "f1" as UUID,
        name: "amount",
        columnName: "amount",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Payments", [amountField]);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "total_amount",
            aggregation: "sum",
            columnName: "amount",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "amount", type: "number" }],
        [{ amount: 100 }, { amount: null }, { amount: 200 }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].total_amount).toBe(300);
    });

    it("should handle null values in avg aggregation", () => {
      const ratingField = createField({
        id: "f1" as UUID,
        name: "rating",
        columnName: "rating",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Reviews", [ratingField]);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "avg_rating",
            aggregation: "avg",
            columnName: "rating",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "rating", type: "number" }],
        [{ rating: 4 }, { rating: null }, { rating: 5 }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].avg_rating).toBe(4.5);
    });

    it("should handle null values in count_distinct aggregation", () => {
      const tagField = createField({
        id: "f1" as UUID,
        name: "tag",
        columnName: "tag",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Posts", [tagField]);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "unique_tags",
            aggregation: "count_distinct",
            columnName: "tag",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "tag", type: "string" }],
        [
          { tag: "javascript" },
          { tag: null },
          { tag: "react" },
          { tag: "javascript" },
        ],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].unique_tags).toBe(2); // Only count non-null distinct values
    });

    it("should handle non-numeric values in sum aggregation", () => {
      const valueField = createField({
        id: "f1" as UUID,
        name: "value",
        columnName: "value",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Data", [valueField]);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "total",
            aggregation: "sum",
            columnName: "value",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "value", type: "string" }],
        [{ value: 10 }, { value: "invalid" }, { value: 20 }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].total).toBe(30);
    });

    it("should return 0 for avg when no numeric values", () => {
      const valueField = createField({
        id: "f1" as UUID,
        name: "value",
        columnName: "value",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Data", [valueField]);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "average",
            aggregation: "avg",
            columnName: "value",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "value", type: "string" }],
        [{ value: null }, { value: "text" }, { value: null }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].average).toBe(0);
    });

    it("should return 0 for min when no numeric values", () => {
      const valueField = createField({
        id: "f1" as UUID,
        name: "value",
        columnName: "value",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Data", [valueField]);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "minimum",
            aggregation: "min",
            columnName: "value",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "value", type: "string" }],
        [{ value: "text" }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].minimum).toBe(0);
    });

    it("should return 0 for max when no numeric values", () => {
      const valueField = createField({
        id: "f1" as UUID,
        name: "value",
        columnName: "value",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Data", [valueField]);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "maximum",
            aggregation: "max",
            columnName: "value",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "value", type: "string" }],
        [{ value: "text" }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].maximum).toBe(0);
    });
  });

  // ============================================================================
  // computeInsightPreview() - Preview Limiting
  // ============================================================================

  describe("computeInsightPreview() - preview limiting", () => {
    it("should limit preview to maxRows parameter", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Products", [categoryField]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "category", type: "string" }],
        [
          { category: "A" },
          { category: "B" },
          { category: "C" },
          { category: "D" },
          { category: "E" },
        ],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData, 3);

      expect(result.rowCount).toBe(5); // Total groups
      expect(result.sampleSize).toBe(3); // Limited preview
      expect(result.dataFrame.rows).toHaveLength(3);
    });

    it("should use default maxRows of 50 when not specified", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Products", [categoryField]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });

      // Create 60 distinct categories
      const rows = Array.from({ length: 60 }, (_, i) => ({
        category: `Category${i}`,
      }));
      const sourceData = createDataFrame(
        [{ name: "category", type: "string" }],
        rows,
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(60); // Total groups
      expect(result.sampleSize).toBe(50); // Default limit
      expect(result.dataFrame.rows).toHaveLength(50);
    });

    it("should return all rows when total is less than maxRows", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Products", [categoryField]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "category", type: "string" }],
        [{ category: "A" }, { category: "B" }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData, 10);

      expect(result.rowCount).toBe(2);
      expect(result.sampleSize).toBe(2);
      expect(result.dataFrame.rows).toHaveLength(2);
    });

    it("should handle maxRows of 0 (no preview)", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Products", [categoryField]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "category", type: "string" }],
        [{ category: "A" }, { category: "B" }, { category: "C" }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData, 0);

      expect(result.rowCount).toBe(3);
      expect(result.sampleSize).toBe(0);
      expect(result.dataFrame.rows).toHaveLength(0);
    });

    it("should handle maxRows of 1", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Products", [categoryField]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "category", type: "string" }],
        [{ category: "A" }, { category: "B" }, { category: "C" }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData, 1);

      expect(result.rowCount).toBe(3);
      expect(result.sampleSize).toBe(1);
      expect(result.dataFrame.rows).toHaveLength(1);
    });
  });

  // ============================================================================
  // computeInsightPreview() - Column Metadata
  // ============================================================================

  describe("computeInsightPreview() - column metadata", () => {
    it("should include field columns in metadata", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Products", [categoryField]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [],
      });
      const sourceData = createDataFrame(
        [{ name: "category", type: "string" }],
        [{ category: "A" }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.columns).toHaveLength(1);
      expect(result.dataFrame.columns[0]).toEqual({
        name: "category",
        type: "string",
      });
    });

    it("should include metric columns in metadata", () => {
      const dataTable = createDataTable("table1", "Orders", []);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "total_orders",
            aggregation: "count",
          }),
          createMetric({
            id: "m2" as UUID,
            name: "avg_value",
            aggregation: "avg",
          }),
        ],
      });
      const sourceData = createDataFrame([], []);

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.columns).toHaveLength(2);
      expect(result.dataFrame.columns[0]).toEqual({
        name: "total_orders",
        type: "number",
      });
      expect(result.dataFrame.columns[1]).toEqual({
        name: "avg_value",
        type: "number",
      });
    });

    it("should include both field and metric columns in metadata", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Sales", [categoryField]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "total_sales",
            aggregation: "sum",
          }),
        ],
      });
      const sourceData = createDataFrame([], []);

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.columns).toHaveLength(2);
      expect(result.dataFrame.columns[0]).toEqual({
        name: "category",
        type: "string",
      });
      expect(result.dataFrame.columns[1]).toEqual({
        name: "total_sales",
        type: "number",
      });
    });

    it("should preserve field types in column metadata", () => {
      const dateField = createField({
        id: "f1" as UUID,
        name: "date",
        columnName: "date",
        type: "date",
      });
      const boolField = createField({
        id: "f2" as UUID,
        name: "active",
        columnName: "active",
        type: "boolean",
      });
      const dataTable = createDataTable("table1", "Data", [dateField, boolField]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID, "f2" as UUID],
        metrics: [],
      });
      const sourceData = createDataFrame([], []);

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.columns).toHaveLength(2);
      expect(result.dataFrame.columns[0]).toEqual({ name: "date", type: "date" });
      expect(result.dataFrame.columns[1]).toEqual({
        name: "active",
        type: "boolean",
      });
    });

    it("should always use number type for metric columns", () => {
      const dataTable = createDataTable("table1", "Data", []);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
          createMetric({
            id: "m2" as UUID,
            name: "sum",
            aggregation: "sum",
          }),
          createMetric({
            id: "m3" as UUID,
            name: "avg",
            aggregation: "avg",
          }),
          createMetric({
            id: "m4" as UUID,
            name: "min",
            aggregation: "min",
          }),
          createMetric({
            id: "m5" as UUID,
            name: "max",
            aggregation: "max",
          }),
          createMetric({
            id: "m6" as UUID,
            name: "count_distinct",
            aggregation: "count_distinct",
          }),
        ],
      });
      const sourceData = createDataFrame([], []);

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.columns).toHaveLength(6);
      result.dataFrame.columns.forEach((column) => {
        expect(column.type).toBe("number");
      });
    });
  });

  // ============================================================================
  // computeInsightPreview() - Edge Cases
  // ============================================================================

  describe("computeInsightPreview() - edge cases", () => {
    it("should handle insight with no metrics and no fields", () => {
      const dataTable = createDataTable("table1", "Empty", []);
      const insight = createInsight({
        selectedFields: [],
        metrics: [],
      });
      const sourceData = createDataFrame([], [{ id: "1" }, { id: "2" }]);

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(1);
      expect(result.dataFrame.rows[0]).toEqual({});
      expect(result.dataFrame.columns).toHaveLength(0);
    });

    it("should handle empty source data", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Products", [categoryField]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "category", type: "string" }],
        [],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(0);
      expect(result.sampleSize).toBe(0);
      expect(result.dataFrame.rows).toHaveLength(0);
    });

    it("should handle field without columnName", () => {
      const field = createField({
        id: "f1" as UUID,
        name: "category",
        type: "string",
      });
      // Delete columnName
      delete (field as { columnName?: string }).columnName;

      const dataTable = createDataTable("table1", "Products", [field]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "category", type: "string" }],
        [{ category: "A" }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      // Field without columnName should be null in result
      expect(result.dataFrame.rows[0].category).toBeUndefined();
    });

    it("should handle metric without columnName for count aggregation", () => {
      const dataTable = createDataTable("table1", "Orders", []);
      const metric = createMetric({
        id: "m1" as UUID,
        name: "total_orders",
        aggregation: "count",
      });
      delete (metric as { columnName?: string }).columnName;

      const insight = createInsight({
        selectedFields: [],
        metrics: [metric],
      });
      const sourceData = createDataFrame([], [{ id: "1" }, { id: "2" }]);

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].total_orders).toBe(2);
    });

    it("should handle metric without columnName for sum aggregation", () => {
      const dataTable = createDataTable("table1", "Data", []);
      const metric = createMetric({
        id: "m1" as UUID,
        name: "total",
        aggregation: "sum",
      });
      delete (metric as { columnName?: string }).columnName;

      const insight = createInsight({
        selectedFields: [],
        metrics: [metric],
      });
      const sourceData = createDataFrame([], [{ value: 10 }]);

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.dataFrame.rows[0].total).toBe(0);
    });

    it("should handle selectedFields with non-existent field IDs", () => {
      const field = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Products", [field]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID, "nonexistent" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "category", type: "string" }],
        [{ category: "A" }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      // Should only include valid field
      expect(result.dataFrame.columns).toHaveLength(2); // category + count
      expect(result.dataFrame.columns[0].name).toBe("category");
    });

    it("should handle undefined selectedFields", () => {
      const dataTable = createDataTable("table1", "Orders", []);
      const insight = createInsight({
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      delete (insight as { selectedFields?: unknown }).selectedFields;

      const sourceData = createDataFrame([], [{ id: "1" }]);

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(1);
      expect(result.dataFrame.rows[0]).toEqual({ count: 1 });
    });

    it("should handle undefined metrics", () => {
      const field = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Products", [field]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
      });
      delete (insight as { metrics?: unknown }).metrics;

      const sourceData = createDataFrame(
        [{ name: "category", type: "string" }],
        [{ category: "A" }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(1);
      expect(result.dataFrame.rows[0]).toEqual({ category: "A" });
      expect(result.dataFrame.columns).toHaveLength(1);
    });

    it("should handle rows with missing grouped field values", () => {
      const field = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "missing_column",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Products", [field]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "other_column", type: "string" }],
        [{ other_column: "A" }, { other_column: "B" }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      // All rows have missing value, so they group together
      expect(result.rowCount).toBe(1);
      expect(result.dataFrame.rows[0].category).toBeUndefined();
      expect(result.dataFrame.rows[0].count).toBe(2);
    });
  });

  // ============================================================================
  // computeInsightDataFrame() - Full DataFrame Computation
  // ============================================================================

  describe("computeInsightDataFrame() - full dataframe computation", () => {
    it("should compute full dataframe without limiting rows", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Products", [categoryField]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });

      // Create 100 distinct categories
      const rows = Array.from({ length: 100 }, (_, i) => ({
        category: `Category${i}`,
      }));
      const sourceData = createDataFrame(
        [{ name: "category", type: "string" }],
        rows,
      );

      const result = computeInsightDataFrame(insight, dataTable, sourceData);

      expect(result.rows).toHaveLength(100);
      expect(result.columns).toHaveLength(2);
    });

    it("should produce same results as computeInsightPreview with Infinity", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const salesField = createField({
        id: "f2" as UUID,
        name: "sales",
        columnName: "sales",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Sales", [
        categoryField,
        salesField,
      ]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "total_sales",
            aggregation: "sum",
            columnName: "sales",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [
          { name: "category", type: "string" },
          { name: "sales", type: "number" },
        ],
        [
          { category: "A", sales: 100 },
          { category: "B", sales: 200 },
          { category: "A", sales: 50 },
        ],
      );

      const fullResult = computeInsightDataFrame(insight, dataTable, sourceData);
      const previewResult = computeInsightPreview(
        insight,
        dataTable,
        sourceData,
        Infinity,
      );

      expect(fullResult).toEqual(previewResult.dataFrame);
    });

    it("should handle grand total computation", () => {
      const salesField = createField({
        id: "f1" as UUID,
        name: "sales",
        columnName: "sales",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Sales", [salesField]);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "total",
            aggregation: "sum",
            columnName: "sales",
          }),
          createMetric({
            id: "m2" as UUID,
            name: "avg",
            aggregation: "avg",
            columnName: "sales",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "sales", type: "number" }],
        [{ sales: 100 }, { sales: 200 }, { sales: 300 }],
      );

      const result = computeInsightDataFrame(insight, dataTable, sourceData);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual({ total: 600, avg: 200 });
    });

    it("should handle empty source data", () => {
      const dataTable = createDataTable("table1", "Empty", []);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame([], []);

      const result = computeInsightDataFrame(insight, dataTable, sourceData);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual({ count: 0 });
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("integration tests", () => {
    it("should handle realistic sales analysis by category and region", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const regionField = createField({
        id: "f2" as UUID,
        name: "region",
        columnName: "region",
        type: "string",
      });
      const salesField = createField({
        id: "f3" as UUID,
        name: "sales",
        columnName: "sales",
        type: "number",
      });
      const quantityField = createField({
        id: "f4" as UUID,
        name: "quantity",
        columnName: "quantity",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Sales", [
        categoryField,
        regionField,
        salesField,
        quantityField,
      ]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID, "f2" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "total_sales",
            aggregation: "sum",
            columnName: "sales",
          }),
          createMetric({
            id: "m2" as UUID,
            name: "total_quantity",
            aggregation: "sum",
            columnName: "quantity",
          }),
          createMetric({
            id: "m3" as UUID,
            name: "avg_sales",
            aggregation: "avg",
            columnName: "sales",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [
          { name: "category", type: "string" },
          { name: "region", type: "string" },
          { name: "sales", type: "number" },
          { name: "quantity", type: "number" },
        ],
        [
          {
            category: "Electronics",
            region: "North",
            sales: 1000,
            quantity: 10,
          },
          {
            category: "Electronics",
            region: "North",
            sales: 1500,
            quantity: 15,
          },
          { category: "Electronics", region: "South", sales: 800, quantity: 8 },
          { category: "Books", region: "North", sales: 200, quantity: 20 },
          { category: "Books", region: "South", sales: 150, quantity: 15 },
        ],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(3);

      const electronicsNorth = result.dataFrame.rows.find(
        (r) => r.category === "Electronics" && r.region === "North",
      );
      const electronicsSouth = result.dataFrame.rows.find(
        (r) => r.category === "Electronics" && r.region === "South",
      );
      const booksNorth = result.dataFrame.rows.find(
        (r) => r.category === "Books" && r.region === "North",
      );

      expect(electronicsNorth).toEqual({
        category: "Electronics",
        region: "North",
        total_sales: 2500,
        total_quantity: 25,
        avg_sales: 1250,
      });
      expect(electronicsSouth).toEqual({
        category: "Electronics",
        region: "South",
        total_sales: 800,
        total_quantity: 8,
        avg_sales: 800,
      });
      expect(booksNorth).toEqual({
        category: "Books",
        region: "North",
        total_sales: 200,
        total_quantity: 20,
        avg_sales: 200,
      });
    });

    it("should handle realistic customer analytics with distinct counts", () => {
      const cityField = createField({
        id: "f1" as UUID,
        name: "city",
        columnName: "city",
        type: "string",
      });
      const customerField = createField({
        id: "f2" as UUID,
        name: "customer_id",
        columnName: "customer_id",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Orders", [
        cityField,
        customerField,
      ]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "order_count",
            aggregation: "count",
          }),
          createMetric({
            id: "m2" as UUID,
            name: "unique_customers",
            aggregation: "count_distinct",
            columnName: "customer_id",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [
          { name: "city", type: "string" },
          { name: "customer_id", type: "string" },
        ],
        [
          { city: "New York", customer_id: "C1" },
          { city: "New York", customer_id: "C1" }, // Repeat customer
          { city: "New York", customer_id: "C2" },
          { city: "Boston", customer_id: "C3" },
          { city: "Boston", customer_id: "C3" }, // Repeat customer
        ],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(2);

      const nyRow = result.dataFrame.rows.find((r) => r.city === "New York");
      const bostonRow = result.dataFrame.rows.find((r) => r.city === "Boston");

      expect(nyRow).toEqual({
        city: "New York",
        order_count: 3,
        unique_customers: 2,
      });
      expect(bostonRow).toEqual({
        city: "Boston",
        order_count: 2,
        unique_customers: 1,
      });
    });

    it("should handle time-series aggregation with all metric types", () => {
      const dateField = createField({
        id: "f1" as UUID,
        name: "date",
        columnName: "date",
        type: "date",
      });
      const temperatureField = createField({
        id: "f2" as UUID,
        name: "temperature",
        columnName: "temperature",
        type: "number",
      });
      const dataTable = createDataTable("table1", "Weather", [
        dateField,
        temperatureField,
      ]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "readings",
            aggregation: "count",
          }),
          createMetric({
            id: "m2" as UUID,
            name: "total_temp",
            aggregation: "sum",
            columnName: "temperature",
          }),
          createMetric({
            id: "m3" as UUID,
            name: "avg_temp",
            aggregation: "avg",
            columnName: "temperature",
          }),
          createMetric({
            id: "m4" as UUID,
            name: "min_temp",
            aggregation: "min",
            columnName: "temperature",
          }),
          createMetric({
            id: "m5" as UUID,
            name: "max_temp",
            aggregation: "max",
            columnName: "temperature",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [
          { name: "date", type: "date" },
          { name: "temperature", type: "number" },
        ],
        [
          { date: "2024-01-01", temperature: 20 },
          { date: "2024-01-01", temperature: 22 },
          { date: "2024-01-01", temperature: 18 },
          { date: "2024-01-02", temperature: 25 },
        ],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData);

      expect(result.rowCount).toBe(2);

      const jan1Row = result.dataFrame.rows.find((r) => r.date === "2024-01-01");
      const jan2Row = result.dataFrame.rows.find((r) => r.date === "2024-01-02");

      expect(jan1Row).toEqual({
        date: "2024-01-01",
        readings: 3,
        total_temp: 60,
        avg_temp: 20,
        min_temp: 18,
        max_temp: 22,
      });
      expect(jan2Row).toEqual({
        date: "2024-01-02",
        readings: 1,
        total_temp: 25,
        avg_temp: 25,
        min_temp: 25,
        max_temp: 25,
      });
    });
  });

  // ============================================================================
  // Type Safety and Immutability
  // ============================================================================

  describe("type safety and immutability", () => {
    it("should return PreviewResult with correct structure", () => {
      const dataTable = createDataTable("table1", "Test", []);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame([], []);

      const result: PreviewResult = computeInsightPreview(
        insight,
        dataTable,
        sourceData,
      );

      expect(result).toHaveProperty("dataFrame");
      expect(result).toHaveProperty("rowCount");
      expect(result).toHaveProperty("sampleSize");
      expect(typeof result.rowCount).toBe("number");
      expect(typeof result.sampleSize).toBe("number");
      expect(result.dataFrame).toHaveProperty("columns");
      expect(result.dataFrame).toHaveProperty("rows");
      expect(Array.isArray(result.dataFrame.columns)).toBe(true);
      expect(Array.isArray(result.dataFrame.rows)).toBe(true);
    });

    it("should ensure sampleSize is never greater than rowCount", () => {
      const categoryField = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Products", [categoryField]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame(
        [{ name: "category", type: "string" }],
        [{ category: "A" }, { category: "B" }, { category: "C" }],
      );

      const result = computeInsightPreview(insight, dataTable, sourceData, 10);

      expect(result.sampleSize).toBeLessThanOrEqual(result.rowCount);
    });

    it("should not mutate input insight", () => {
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const originalSelectedFields = [...(insight.selectedFields ?? [])];
      const originalMetrics = [...(insight.metrics ?? [])];
      const dataTable = createDataTable("table1", "Test", []);
      const sourceData = createDataFrame([], []);

      computeInsightPreview(insight, dataTable, sourceData);

      expect(insight.selectedFields).toEqual(originalSelectedFields);
      expect(insight.metrics).toEqual(originalMetrics);
    });

    it("should not mutate input dataTable", () => {
      const field = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Products", [field]);
      const originalFields = [...dataTable.fields];
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [],
      });
      const sourceData = createDataFrame([], []);

      computeInsightPreview(insight, dataTable, sourceData);

      expect(dataTable.fields).toEqual(originalFields);
    });

    it("should not mutate input sourceDataFrame", () => {
      const sourceData = createDataFrame(
        [{ name: "category", type: "string" }],
        [{ category: "A" }, { category: "B" }],
      );
      const originalRows = [...sourceData.rows];
      const originalColumns = [...sourceData.columns];

      const field = createField({
        id: "f1" as UUID,
        name: "category",
        columnName: "category",
        type: "string",
      });
      const dataTable = createDataTable("table1", "Products", [field]);
      const insight = createInsight({
        selectedFields: ["f1" as UUID],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });

      computeInsightPreview(insight, dataTable, sourceData);

      expect(sourceData.rows).toEqual(originalRows);
      expect(sourceData.columns).toEqual(originalColumns);
    });

    it("should return DataFrameData for computeInsightDataFrame", () => {
      const dataTable = createDataTable("table1", "Test", []);
      const insight = createInsight({
        selectedFields: [],
        metrics: [
          createMetric({
            id: "m1" as UUID,
            name: "count",
            aggregation: "count",
          }),
        ],
      });
      const sourceData = createDataFrame([], []);

      const result: DataFrameData = computeInsightDataFrame(
        insight,
        dataTable,
        sourceData,
      );

      expect(result).toHaveProperty("columns");
      expect(result).toHaveProperty("rows");
      expect(Array.isArray(result.columns)).toBe(true);
      expect(Array.isArray(result.rows)).toBe(true);
    });
  });
});
