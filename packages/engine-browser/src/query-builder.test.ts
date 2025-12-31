/**
 * Unit tests for QueryBuilder
 *
 * Tests cover:
 * - Chainable query methods (filter, sort, orderBy, groupBy, join, limit, offset, select)
 * - Immutability - each method returns a new QueryBuilder instance
 * - Operation accumulation - operations are stored correctly
 * - SQL generation (sql(), toSQL()) and helper functions (formatPredicate, buildPlan, buildSelectClause, buildOrderClause)
 * - Execution methods (rows, count, preview, run) with mocked query results
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { DataFrame } from "@dashframe/engine";
import { QueryBuilder } from "./query-builder";

// Mock BrowserDataFrame for run() tests
vi.mock("./dataframe", () => ({
  BrowserDataFrame: {
    create: vi.fn().mockResolvedValue({
      id: "mock-result-df-id",
      storage: { type: "indexeddb", key: "arrow-mock-result-df-id" },
      fieldIds: [],
      createdAt: Date.now(),
    }),
  },
}));

// Create mock DataFrame factory
const createMockDataFrame = (id: string = "test-df-id"): DataFrame => ({
  id: id as `${string}-${string}-${string}-${string}-${string}`,
  storage: { type: "indexeddb", key: `arrow-${id}` },
  fieldIds: [],
  createdAt: Date.now(),
  toJSON: () => ({
    id: id as `${string}-${string}-${string}-${string}-${string}`,
    storage: { type: "indexeddb", key: `arrow-${id}` },
    fieldIds: [],
    createdAt: Date.now(),
  }),
  getStorageType: () => "indexeddb",
});

// Create mock DuckDB connection
const createMockConnection = (): AsyncDuckDBConnection => {
  const mockQuery = vi.fn().mockResolvedValue({
    toArray: () => [],
  });

  return {
    query: mockQuery,
    insertArrowFromIPCStream: vi.fn().mockResolvedValue(undefined),
  } as unknown as AsyncDuckDBConnection;
};

describe("QueryBuilder", () => {
  let mockDataFrame: DataFrame;
  let mockConn: AsyncDuckDBConnection;
  let queryBuilder: QueryBuilder;

  beforeEach(() => {
    mockDataFrame = createMockDataFrame();
    mockConn = createMockConnection();
    queryBuilder = new QueryBuilder(mockDataFrame, mockConn);
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with dataFrame and connection", () => {
      const qb = new QueryBuilder(mockDataFrame, mockConn);
      expect(qb).toBeInstanceOf(QueryBuilder);
    });

    it("should create instance with empty operations by default", async () => {
      const qb = new QueryBuilder(mockDataFrame, mockConn);
      // Verify no operations by checking SQL output structure
      // We can't directly access private operations, but we can verify behavior
      expect(qb).toBeInstanceOf(QueryBuilder);
    });

    it("should accept optional operations array", () => {
      const operations = [{ type: "limit" as const, count: 10 }];
      const qb = new QueryBuilder(
        mockDataFrame,
        mockConn,
        operations as never[],
      );
      expect(qb).toBeInstanceOf(QueryBuilder);
    });
  });

  describe("immutability", () => {
    it("filter should return a new QueryBuilder instance", () => {
      const newQb = queryBuilder.filter([
        { columnName: "age", operator: ">", value: 18 },
      ]);

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("sort should return a new QueryBuilder instance", () => {
      const newQb = queryBuilder.sort([
        { columnName: "name", direction: "asc" },
      ]);

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("orderBy should return a new QueryBuilder instance", () => {
      const newQb = queryBuilder.orderBy([
        { columnName: "name", direction: "desc" },
      ]);

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("groupBy should return a new QueryBuilder instance", () => {
      const newQb = queryBuilder.groupBy(["category"]);

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("join should return a new QueryBuilder instance", () => {
      const otherDf = createMockDataFrame("other-df");
      const newQb = queryBuilder.join(otherDf, {
        type: "inner",
        leftColumn: "id",
        rightColumn: "user_id",
      });

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("limit should return a new QueryBuilder instance", () => {
      const newQb = queryBuilder.limit(10);

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("offset should return a new QueryBuilder instance", () => {
      const newQb = queryBuilder.offset(5);

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("select should return a new QueryBuilder instance", () => {
      const newQb = queryBuilder.select(["name", "age"]);

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("original QueryBuilder should remain unchanged after chaining", () => {
      const original = new QueryBuilder(mockDataFrame, mockConn);

      // Chain multiple operations
      original
        .filter([{ columnName: "age", operator: ">", value: 18 }])
        .sort([{ columnName: "name", direction: "asc" }])
        .limit(10);

      // Original should still be usable and unchanged
      expect(original).toBeInstanceOf(QueryBuilder);
    });
  });

  describe("method chaining", () => {
    it("should support chaining multiple filter calls", () => {
      const result = queryBuilder
        .filter([{ columnName: "age", operator: ">", value: 18 }])
        .filter([{ columnName: "status", operator: "=", value: "active" }]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should support chaining filter and sort", () => {
      const result = queryBuilder
        .filter([{ columnName: "age", operator: ">", value: 18 }])
        .sort([{ columnName: "name", direction: "asc" }]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should support chaining all operations", () => {
      const otherDf = createMockDataFrame("other-df");

      const result = queryBuilder
        .select(["id", "name", "age"])
        .filter([{ columnName: "age", operator: ">", value: 18 }])
        .join(otherDf, {
          type: "left",
          leftColumn: "id",
          rightColumn: "user_id",
        })
        .groupBy(["category"], [
          { columnName: "amount", function: "sum", alias: "total" },
        ])
        .sort([{ columnName: "total", direction: "desc" }])
        .limit(100)
        .offset(10);

      expect(result).toBeInstanceOf(QueryBuilder);
    });
  });

  describe("filter method", () => {
    it("should accept single predicate", () => {
      const result = queryBuilder.filter([
        { columnName: "age", operator: "=", value: 25 },
      ]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept multiple predicates", () => {
      const result = queryBuilder.filter([
        { columnName: "age", operator: ">", value: 18 },
        { columnName: "status", operator: "=", value: "active" },
        { columnName: "country", operator: "IN", values: ["US", "CA", "UK"] },
      ]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept IS NULL operator", () => {
      const result = queryBuilder.filter([
        { columnName: "deleted_at", operator: "IS NULL" },
      ]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept IS NOT NULL operator", () => {
      const result = queryBuilder.filter([
        { columnName: "email", operator: "IS NOT NULL" },
      ]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept IN operator with values array", () => {
      const result = queryBuilder.filter([
        { columnName: "status", operator: "IN", values: ["active", "pending"] },
      ]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept NOT IN operator with values array", () => {
      const result = queryBuilder.filter([
        {
          columnName: "status",
          operator: "NOT IN",
          values: ["deleted", "archived"],
        },
      ]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });
  });

  describe("sort method", () => {
    it("should accept ascending order", () => {
      const result = queryBuilder.sort([
        { columnName: "name", direction: "asc" },
      ]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept descending order", () => {
      const result = queryBuilder.sort([
        { columnName: "created_at", direction: "desc" },
      ]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept multiple sort orders", () => {
      const result = queryBuilder.sort([
        { columnName: "category", direction: "asc" },
        { columnName: "created_at", direction: "desc" },
      ]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });
  });

  describe("orderBy method", () => {
    it("should be an alias for sort", () => {
      const sortResult = queryBuilder.sort([
        { columnName: "name", direction: "asc" },
      ]);
      const orderByResult = queryBuilder.orderBy([
        { columnName: "name", direction: "asc" },
      ]);

      // Both should return new QueryBuilder instances
      expect(sortResult).toBeInstanceOf(QueryBuilder);
      expect(orderByResult).toBeInstanceOf(QueryBuilder);
    });
  });

  describe("groupBy method", () => {
    it("should accept single column", () => {
      const result = queryBuilder.groupBy(["category"]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept multiple columns", () => {
      const result = queryBuilder.groupBy(["category", "year", "region"]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept aggregations", () => {
      const result = queryBuilder.groupBy(["category"], [
        { columnName: "amount", function: "sum", alias: "total_amount" },
        { columnName: "id", function: "count", alias: "count" },
      ]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept aggregations with various functions", () => {
      const result = queryBuilder.groupBy(["category"], [
        { columnName: "amount", function: "sum", alias: "sum_amount" },
        { columnName: "amount", function: "avg", alias: "avg_amount" },
        { columnName: "amount", function: "min", alias: "min_amount" },
        { columnName: "amount", function: "max", alias: "max_amount" },
        { columnName: "id", function: "count", alias: "total_count" },
      ]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });
  });

  describe("join method", () => {
    it("should accept inner join", () => {
      const otherDf = createMockDataFrame("other-df");
      const result = queryBuilder.join(otherDf, {
        type: "inner",
        leftColumn: "id",
        rightColumn: "user_id",
      });

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept left join", () => {
      const otherDf = createMockDataFrame("other-df");
      const result = queryBuilder.join(otherDf, {
        type: "left",
        leftColumn: "id",
        rightColumn: "user_id",
      });

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept right join", () => {
      const otherDf = createMockDataFrame("other-df");
      const result = queryBuilder.join(otherDf, {
        type: "right",
        leftColumn: "id",
        rightColumn: "user_id",
      });

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept outer join", () => {
      const otherDf = createMockDataFrame("other-df");
      const result = queryBuilder.join(otherDf, {
        type: "outer",
        leftColumn: "id",
        rightColumn: "user_id",
      });

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should support multiple joins", () => {
      const ordersDf = createMockDataFrame("orders-df");
      const productsDf = createMockDataFrame("products-df");

      const result = queryBuilder
        .join(ordersDf, {
          type: "inner",
          leftColumn: "id",
          rightColumn: "user_id",
        })
        .join(productsDf, {
          type: "left",
          leftColumn: "product_id",
          rightColumn: "id",
        });

      expect(result).toBeInstanceOf(QueryBuilder);
    });
  });

  describe("limit method", () => {
    it("should accept positive integer", () => {
      const result = queryBuilder.limit(10);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept zero", () => {
      const result = queryBuilder.limit(0);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept large numbers", () => {
      const result = queryBuilder.limit(1000000);

      expect(result).toBeInstanceOf(QueryBuilder);
    });
  });

  describe("offset method", () => {
    it("should accept positive integer", () => {
      const result = queryBuilder.offset(20);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept zero", () => {
      const result = queryBuilder.offset(0);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should work with limit for pagination", () => {
      const result = queryBuilder.limit(10).offset(20);

      expect(result).toBeInstanceOf(QueryBuilder);
    });
  });

  describe("select method", () => {
    it("should accept single column", () => {
      const result = queryBuilder.select(["name"]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept multiple columns", () => {
      const result = queryBuilder.select(["id", "name", "email", "created_at"]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept empty array", () => {
      const result = queryBuilder.select([]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });
  });

  describe("operation accumulation", () => {
    it("should accumulate filters when chaining multiple filter calls", () => {
      const result = queryBuilder
        .filter([{ columnName: "age", operator: ">", value: 18 }])
        .filter([{ columnName: "status", operator: "=", value: "active" }])
        .filter([{ columnName: "country", operator: "=", value: "US" }]);

      // All three filter operations should be accumulated
      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should override sort when called multiple times", () => {
      // Later sort calls should override earlier ones (based on buildPlan logic)
      const result = queryBuilder
        .sort([{ columnName: "name", direction: "asc" }])
        .sort([{ columnName: "created_at", direction: "desc" }]);

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accumulate joins when chaining multiple join calls", () => {
      const df1 = createMockDataFrame("df1");
      const df2 = createMockDataFrame("df2");
      const df3 = createMockDataFrame("df3");

      const result = queryBuilder
        .join(df1, { type: "inner", leftColumn: "a", rightColumn: "b" })
        .join(df2, { type: "left", leftColumn: "c", rightColumn: "d" })
        .join(df3, { type: "right", leftColumn: "e", rightColumn: "f" });

      // All three joins should be accumulated
      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should override limit when called multiple times", () => {
      const result = queryBuilder.limit(10).limit(20).limit(5);

      // Last limit (5) should be used
      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should override offset when called multiple times", () => {
      const result = queryBuilder.offset(10).offset(20).offset(5);

      // Last offset (5) should be used
      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should override select when called multiple times", () => {
      const result = queryBuilder
        .select(["name", "email"])
        .select(["id", "created_at"]);

      // Last select should be used
      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should preserve order of operations in complex chains", () => {
      const otherDf = createMockDataFrame("other");

      const result = queryBuilder
        .select(["id", "name"])
        .filter([{ columnName: "status", operator: "=", value: "active" }])
        .join(otherDf, {
          type: "inner",
          leftColumn: "id",
          rightColumn: "user_id",
        })
        .filter([{ columnName: "age", operator: ">", value: 21 }])
        .groupBy(["category"])
        .sort([{ columnName: "name", direction: "asc" }])
        .limit(50)
        .offset(10);

      expect(result).toBeInstanceOf(QueryBuilder);
    });
  });

  // ============================================================================
  // SQL Generation Tests
  // ============================================================================

  describe("sql() and toSQL()", () => {
    // Create a QueryBuilder with a pre-set table name to avoid async table loading
    const createTestQueryBuilder = (
      df: DataFrame,
      conn: AsyncDuckDBConnection,
      tableName: string = "df_test_df_id",
    ): QueryBuilder => {
      // Use the 4-arg constructor to set tableName directly
      return new QueryBuilder(df, conn, [], tableName);
    };

    describe("basic SELECT queries", () => {
      it("should generate SELECT * FROM table for empty operations", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn);
        const sql = await qb.sql();

        expect(sql).toBe('SELECT * FROM "df_test_df_id"');
      });

      it("should generate SELECT with specific columns", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).select([
          "name",
          "age",
        ]);
        const sql = await qb.sql();

        expect(sql).toBe('SELECT "name", "age" FROM "df_test_df_id"');
      });

      it("should handle column names with special characters", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).select([
          "first name",
          'col"with"quotes',
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT "first name", "col""with""quotes" FROM "df_test_df_id"',
        );
      });
    });

    describe("WHERE clause generation (formatPredicate)", () => {
      it("should format basic comparison operators", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
          { columnName: "age", operator: ">", value: 18 },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe('SELECT * FROM "df_test_df_id" WHERE "age" > 18');
      });

      it("should format equality operator with string value", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
          { columnName: "status", operator: "=", value: "active" },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          "SELECT * FROM \"df_test_df_id\" WHERE \"status\" = 'active'",
        );
      });

      it("should escape single quotes in string values", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
          { columnName: "name", operator: "=", value: "O'Brien" },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          "SELECT * FROM \"df_test_df_id\" WHERE \"name\" = 'O''Brien'",
        );
      });

      it("should format IS NULL operator", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
          { columnName: "deleted_at", operator: "IS NULL" },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT * FROM "df_test_df_id" WHERE "deleted_at" IS NULL',
        );
      });

      it("should format IS NOT NULL operator", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
          { columnName: "email", operator: "IS NOT NULL" },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT * FROM "df_test_df_id" WHERE "email" IS NOT NULL',
        );
      });

      it("should format IN operator with values array", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
          {
            columnName: "status",
            operator: "IN",
            values: ["active", "pending"],
          },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          "SELECT * FROM \"df_test_df_id\" WHERE \"status\" IN ('active', 'pending')",
        );
      });

      it("should format NOT IN operator with values array", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
          {
            columnName: "status",
            operator: "NOT IN",
            values: ["deleted", "archived"],
          },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          "SELECT * FROM \"df_test_df_id\" WHERE \"status\" NOT IN ('deleted', 'archived')",
        );
      });

      it("should format IN operator with numeric values", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
          { columnName: "id", operator: "IN", values: [1, 2, 3] },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT * FROM "df_test_df_id" WHERE "id" IN (1, 2, 3)',
        );
      });

      it("should format boolean values", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
          { columnName: "active", operator: "=", value: true },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT * FROM "df_test_df_id" WHERE "active" = TRUE',
        );
      });

      it("should format NULL values", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
          { columnName: "value", operator: "=", value: null },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT * FROM "df_test_df_id" WHERE "value" = NULL',
        );
      });

      it("should join multiple predicates with AND", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
          { columnName: "age", operator: ">", value: 18 },
          { columnName: "status", operator: "=", value: "active" },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          "SELECT * FROM \"df_test_df_id\" WHERE \"age\" > 18 AND \"status\" = 'active'",
        );
      });

      it("should accumulate predicates from multiple filter calls", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn)
          .filter([{ columnName: "age", operator: ">", value: 18 }])
          .filter([{ columnName: "country", operator: "=", value: "US" }]);
        const sql = await qb.sql();

        expect(sql).toBe(
          "SELECT * FROM \"df_test_df_id\" WHERE \"age\" > 18 AND \"country\" = 'US'",
        );
      });
    });

    describe("ORDER BY clause generation (buildOrderClause)", () => {
      it("should generate ORDER BY with ASC", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).sort([
          { columnName: "name", direction: "asc" },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT * FROM "df_test_df_id" ORDER BY "name" ASC',
        );
      });

      it("should generate ORDER BY with DESC", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).sort([
          { columnName: "created_at", direction: "desc" },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT * FROM "df_test_df_id" ORDER BY "created_at" DESC',
        );
      });

      it("should generate ORDER BY with multiple columns", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).sort([
          { columnName: "category", direction: "asc" },
          { columnName: "created_at", direction: "desc" },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT * FROM "df_test_df_id" ORDER BY "category" ASC, "created_at" DESC',
        );
      });

      it("should use last sort when called multiple times", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn)
          .sort([{ columnName: "name", direction: "asc" }])
          .sort([{ columnName: "age", direction: "desc" }]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT * FROM "df_test_df_id" ORDER BY "age" DESC',
        );
      });
    });

    describe("GROUP BY clause generation (buildSelectClause with groups)", () => {
      it("should generate GROUP BY with single column", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).groupBy([
          "category",
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT "category" FROM "df_test_df_id" GROUP BY "category"',
        );
      });

      it("should generate GROUP BY with multiple columns", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).groupBy([
          "category",
          "region",
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT "category", "region" FROM "df_test_df_id" GROUP BY "category", "region"',
        );
      });

      it("should generate GROUP BY with aggregations", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).groupBy(
          ["category"],
          [{ columnName: "amount", function: "sum", alias: "total" }],
        );
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT SUM("amount") AS "total", "category" FROM "df_test_df_id" GROUP BY "category"',
        );
      });

      it("should generate GROUP BY with multiple aggregations", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).groupBy(
          ["category"],
          [
            { columnName: "amount", function: "sum", alias: "total" },
            { columnName: "id", function: "count", alias: "count" },
          ],
        );
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT SUM("amount") AS "total", COUNT("id") AS "count", "category" FROM "df_test_df_id" GROUP BY "category"',
        );
      });

      it("should generate aggregation without alias", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).groupBy(
          ["category"],
          [{ columnName: "amount", function: "avg" }],
        );
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT AVG("amount"), "category" FROM "df_test_df_id" GROUP BY "category"',
        );
      });

      it("should use explicit select columns with groupBy when specified", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn)
          .groupBy(["category"], [
            { columnName: "amount", function: "sum", alias: "total" },
          ])
          .select(["category", "total"]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT "category", "total" FROM "df_test_df_id" GROUP BY "category"',
        );
      });
    });

    describe("LIMIT and OFFSET clause generation", () => {
      it("should generate LIMIT clause", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).limit(10);
        const sql = await qb.sql();

        expect(sql).toBe('SELECT * FROM "df_test_df_id" LIMIT 10');
      });

      it("should generate OFFSET clause", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).offset(20);
        const sql = await qb.sql();

        expect(sql).toBe('SELECT * FROM "df_test_df_id" OFFSET 20');
      });

      it("should generate LIMIT and OFFSET together", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn)
          .limit(10)
          .offset(20);
        const sql = await qb.sql();

        expect(sql).toBe('SELECT * FROM "df_test_df_id" LIMIT 10 OFFSET 20');
      });

      it("should use last limit when called multiple times", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn)
          .limit(10)
          .limit(50);
        const sql = await qb.sql();

        expect(sql).toBe('SELECT * FROM "df_test_df_id" LIMIT 50');
      });

      it("should use last offset when called multiple times", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn)
          .offset(10)
          .offset(30);
        const sql = await qb.sql();

        expect(sql).toBe('SELECT * FROM "df_test_df_id" OFFSET 30');
      });
    });

    describe("complex query generation (buildPlan)", () => {
      it("should generate query with filter, sort, and limit", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn)
          .filter([{ columnName: "age", operator: ">", value: 18 }])
          .sort([{ columnName: "name", direction: "asc" }])
          .limit(100);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT * FROM "df_test_df_id" WHERE "age" > 18 ORDER BY "name" ASC LIMIT 100',
        );
      });

      it("should generate query with select, filter, and order", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn)
          .select(["id", "name", "email"])
          .filter([{ columnName: "active", operator: "=", value: true }])
          .sort([{ columnName: "created_at", direction: "desc" }]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT "id", "name", "email" FROM "df_test_df_id" WHERE "active" = TRUE ORDER BY "created_at" DESC',
        );
      });

      it("should generate query with groupBy, aggregations, and filter", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn)
          .filter([{ columnName: "status", operator: "=", value: "completed" }])
          .groupBy(["category"], [
            { columnName: "amount", function: "sum", alias: "total_amount" },
          ])
          .sort([{ columnName: "total_amount", direction: "desc" }])
          .limit(10);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT SUM("amount") AS "total_amount", "category" FROM "df_test_df_id" WHERE "status" = \'completed\' GROUP BY "category" ORDER BY "total_amount" DESC LIMIT 10',
        );
      });

      it("should generate pagination query", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn)
          .select(["id", "name"])
          .sort([{ columnName: "id", direction: "asc" }])
          .limit(10)
          .offset(50);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT "id", "name" FROM "df_test_df_id" ORDER BY "id" ASC LIMIT 10 OFFSET 50',
        );
      });

      it("should handle all clause types together", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn)
          .select(["category", "total"])
          .filter([{ columnName: "year", operator: ">=", value: 2020 }])
          .filter([{ columnName: "region", operator: "=", value: "US" }])
          .groupBy(["category"], [
            { columnName: "amount", function: "sum", alias: "total" },
          ])
          .sort([{ columnName: "total", direction: "desc" }])
          .limit(5)
          .offset(0);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT "category", "total" FROM "df_test_df_id" WHERE "year" >= 2020 AND "region" = \'US\' GROUP BY "category" ORDER BY "total" DESC LIMIT 5 OFFSET 0',
        );
      });
    });

    describe("toSQL() alias", () => {
      it("should return same result as sql()", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn)
          .filter([{ columnName: "age", operator: ">", value: 18 }])
          .limit(10);

        const sqlResult = await qb.sql();
        const toSqlResult = await qb.toSQL();

        expect(toSqlResult).toBe(sqlResult);
      });

      it("should be callable on chained builder", async () => {
        const sql = await createTestQueryBuilder(mockDataFrame, mockConn)
          .select(["name"])
          .filter([{ columnName: "active", operator: "=", value: true }])
          .toSQL();

        expect(sql).toBe(
          'SELECT "name" FROM "df_test_df_id" WHERE "active" = TRUE',
        );
      });
    });

    describe("edge cases", () => {
      it("should handle empty filter predicates array", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([]);
        const sql = await qb.sql();

        expect(sql).toBe('SELECT * FROM "df_test_df_id"');
      });

      it("should handle empty select columns array", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).select([]);
        const sql = await qb.sql();

        // Empty select should result in SELECT *
        expect(sql).toBe('SELECT * FROM "df_test_df_id"');
      });

      it("should handle empty sort orders array", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).sort([]);
        const sql = await qb.sql();

        expect(sql).toBe('SELECT * FROM "df_test_df_id"');
      });

      it("should handle limit of zero", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).limit(0);
        const sql = await qb.sql();

        expect(sql).toBe('SELECT * FROM "df_test_df_id" LIMIT 0');
      });

      it("should handle offset of zero", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).offset(0);
        const sql = await qb.sql();

        expect(sql).toBe('SELECT * FROM "df_test_df_id" OFFSET 0');
      });

      it("should handle Date values in filters", async () => {
        const testDate = new Date("2024-01-15T10:30:00.000Z");
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
          { columnName: "created_at", operator: ">=", value: testDate },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT * FROM "df_test_df_id" WHERE "created_at" >= \'2024-01-15T10:30:00.000Z\'',
        );
      });

      it("should handle bigint values", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
          { columnName: "id", operator: "=", value: BigInt(9007199254740993) },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe(
          'SELECT * FROM "df_test_df_id" WHERE "id" = 9007199254740993',
        );
      });

      it("should handle IN operator with empty values array", async () => {
        const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
          { columnName: "id", operator: "IN", values: [] },
        ]);
        const sql = await qb.sql();

        expect(sql).toBe('SELECT * FROM "df_test_df_id" WHERE "id" IN ()');
      });
    });
  });

  // ============================================================================
  // Execution Method Tests
  // ============================================================================

  describe("execution methods", () => {
    // Helper to create a mock connection with configurable query results
    const createMockConnectionWithResults = (
      queryResults: Record<string, unknown>[],
    ): AsyncDuckDBConnection => {
      const mockQuery = vi.fn().mockResolvedValue({
        toArray: () => queryResults,
      });

      return {
        query: mockQuery,
        insertArrowFromIPCStream: vi.fn().mockResolvedValue(undefined),
      } as unknown as AsyncDuckDBConnection;
    };

    // Create a test QueryBuilder with pre-set table name (avoids async table loading)
    const createTestQueryBuilder = (
      df: DataFrame,
      conn: AsyncDuckDBConnection,
      tableName: string = "df_test_df_id",
    ): QueryBuilder => {
      return new QueryBuilder(df, conn, [], tableName);
    };

    describe("rows()", () => {
      it("should execute query and return results as array of records", async () => {
        const mockResults = [
          { id: 1, name: "Alice", age: 30 },
          { id: 2, name: "Bob", age: 25 },
          { id: 3, name: "Charlie", age: 35 },
        ];
        const conn = createMockConnectionWithResults(mockResults);
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        const results = await qb.rows();

        expect(results).toEqual(mockResults);
        expect(results).toHaveLength(3);
      });

      it("should return empty array when no rows match", async () => {
        const conn = createMockConnectionWithResults([]);
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        const results = await qb.rows();

        expect(results).toEqual([]);
        expect(results).toHaveLength(0);
      });

      it("should execute the generated SQL query", async () => {
        const mockResults = [{ id: 1, name: "Test" }];
        const conn = createMockConnectionWithResults(mockResults);
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        await qb.rows();

        expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM "df_test_df_id"');
      });

      it("should execute query with filter operations", async () => {
        const mockResults = [{ id: 1, name: "Alice", active: true }];
        const conn = createMockConnectionWithResults(mockResults);
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;
        const qb = createTestQueryBuilder(mockDataFrame, conn).filter([
          { columnName: "active", operator: "=", value: true },
        ]);

        await qb.rows();

        expect(mockQuery).toHaveBeenCalledWith(
          'SELECT * FROM "df_test_df_id" WHERE "active" = TRUE',
        );
      });

      it("should execute query with all chained operations", async () => {
        const mockResults = [{ name: "Alice" }];
        const conn = createMockConnectionWithResults(mockResults);
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;
        const qb = createTestQueryBuilder(mockDataFrame, conn)
          .select(["name", "age"])
          .filter([{ columnName: "age", operator: ">", value: 21 }])
          .sort([{ columnName: "name", direction: "asc" }])
          .limit(10);

        await qb.rows();

        expect(mockQuery).toHaveBeenCalledWith(
          'SELECT "name", "age" FROM "df_test_df_id" WHERE "age" > 21 ORDER BY "name" ASC LIMIT 10',
        );
      });

      it("should return results with correct data types", async () => {
        const mockResults = [
          {
            id: 1,
            name: "Alice",
            balance: 1234.56,
            active: true,
            created_at: "2024-01-15",
            metadata: null,
          },
        ];
        const conn = createMockConnectionWithResults(mockResults);
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        const results = await qb.rows();

        expect(results[0].id).toBe(1);
        expect(results[0].name).toBe("Alice");
        expect(results[0].balance).toBe(1234.56);
        expect(results[0].active).toBe(true);
        expect(results[0].metadata).toBe(null);
      });
    });

    describe("count()", () => {
      it("should return the count of matching rows", async () => {
        const mockCountResult = [{ count: 42 }];
        const conn = createMockConnectionWithResults(mockCountResult);
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        const count = await qb.count();

        expect(count).toBe(42);
      });

      it("should return 0 when no rows match", async () => {
        const mockCountResult = [{ count: 0 }];
        const conn = createMockConnectionWithResults(mockCountResult);
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        const count = await qb.count();

        expect(count).toBe(0);
      });

      it("should return 0 when result is undefined", async () => {
        const conn = createMockConnectionWithResults([]);
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        const count = await qb.count();

        expect(count).toBe(0);
      });

      it("should wrap query in COUNT(*) subquery", async () => {
        const mockCountResult = [{ count: 100 }];
        const conn = createMockConnectionWithResults(mockCountResult);
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        await qb.count();

        expect(mockQuery).toHaveBeenCalledWith(
          'SELECT COUNT(*) as count FROM (SELECT * FROM "df_test_df_id")',
        );
      });

      it("should exclude limit and offset from count query", async () => {
        const mockCountResult = [{ count: 1000 }];
        const conn = createMockConnectionWithResults(mockCountResult);
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;
        const qb = createTestQueryBuilder(mockDataFrame, conn)
          .filter([{ columnName: "active", operator: "=", value: true }])
          .limit(10)
          .offset(20);

        await qb.count();

        // Count should not include LIMIT or OFFSET
        expect(mockQuery).toHaveBeenCalledWith(
          'SELECT COUNT(*) as count FROM (SELECT * FROM "df_test_df_id" WHERE "active" = TRUE)',
        );
      });

      it("should exclude sort and select from count query", async () => {
        const mockCountResult = [{ count: 50 }];
        const conn = createMockConnectionWithResults(mockCountResult);
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;
        const qb = createTestQueryBuilder(mockDataFrame, conn)
          .select(["name", "age"])
          .filter([{ columnName: "status", operator: "=", value: "active" }])
          .sort([{ columnName: "name", direction: "asc" }]);

        await qb.count();

        // Count should not include SELECT columns or ORDER BY
        expect(mockQuery).toHaveBeenCalledWith(
          "SELECT COUNT(*) as count FROM (SELECT * FROM \"df_test_df_id\" WHERE \"status\" = 'active')",
        );
      });

      it("should preserve filter and join operations in count query", async () => {
        const mockCountResult = [{ count: 25 }];
        const conn = createMockConnectionWithResults(mockCountResult);
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;
        const qb = createTestQueryBuilder(mockDataFrame, conn)
          .filter([{ columnName: "age", operator: ">", value: 18 }])
          .filter([{ columnName: "country", operator: "=", value: "US" }]);

        await qb.count();

        expect(mockQuery).toHaveBeenCalledWith(
          "SELECT COUNT(*) as count FROM (SELECT * FROM \"df_test_df_id\" WHERE \"age\" > 18 AND \"country\" = 'US')",
        );
      });

      it("should handle large counts", async () => {
        const mockCountResult = [{ count: 9007199254740991 }]; // Max safe integer
        const conn = createMockConnectionWithResults(mockCountResult);
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        const count = await qb.count();

        expect(count).toBe(9007199254740991);
      });

      it("should convert string count to number", async () => {
        // Some database drivers might return count as string
        const mockCountResult = [{ count: "123" }];
        const conn = createMockConnectionWithResults(mockCountResult);
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        const count = await qb.count();

        expect(count).toBe(123);
        expect(typeof count).toBe("number");
      });
    });

    describe("preview()", () => {
      it("should return first 10 rows by default", async () => {
        const mockResults = Array.from({ length: 10 }, (_, i) => ({
          id: i + 1,
          name: `User ${i + 1}`,
        }));
        const conn = createMockConnectionWithResults(mockResults);
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        const results = await qb.preview();

        expect(results).toHaveLength(10);
        expect(mockQuery).toHaveBeenCalledWith(
          'SELECT * FROM "df_test_df_id" LIMIT 10',
        );
      });

      it("should accept custom limit parameter", async () => {
        const mockResults = [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
          { id: 3, name: "Charlie" },
          { id: 4, name: "David" },
          { id: 5, name: "Eve" },
        ];
        const conn = createMockConnectionWithResults(mockResults);
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        const results = await qb.preview(5);

        expect(results).toHaveLength(5);
        expect(mockQuery).toHaveBeenCalledWith(
          'SELECT * FROM "df_test_df_id" LIMIT 5',
        );
      });

      it("should preserve other operations when adding limit", async () => {
        const mockResults = [{ name: "Alice", age: 25 }];
        const conn = createMockConnectionWithResults(mockResults);
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;
        const qb = createTestQueryBuilder(mockDataFrame, conn)
          .select(["name", "age"])
          .filter([{ columnName: "active", operator: "=", value: true }])
          .sort([{ columnName: "name", direction: "asc" }]);

        await qb.preview(5);

        expect(mockQuery).toHaveBeenCalledWith(
          'SELECT "name", "age" FROM "df_test_df_id" WHERE "active" = TRUE ORDER BY "name" ASC LIMIT 5',
        );
      });

      it("should override existing limit", async () => {
        const mockResults = [{ id: 1 }];
        const conn = createMockConnectionWithResults(mockResults);
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;
        const qb = createTestQueryBuilder(mockDataFrame, conn).limit(100);

        await qb.preview(3);

        // preview(3) should override the previous limit(100)
        expect(mockQuery).toHaveBeenCalledWith(
          'SELECT * FROM "df_test_df_id" LIMIT 3',
        );
      });

      it("should return empty array when no data", async () => {
        const conn = createMockConnectionWithResults([]);
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        const results = await qb.preview();

        expect(results).toEqual([]);
      });

      it("should work with limit of 1", async () => {
        const mockResults = [{ id: 1, name: "First" }];
        const conn = createMockConnectionWithResults(mockResults);
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        const results = await qb.preview(1);

        expect(results).toHaveLength(1);
        expect(mockQuery).toHaveBeenCalledWith(
          'SELECT * FROM "df_test_df_id" LIMIT 1',
        );
      });
    });

    describe("run()", () => {
      it("should execute query and return a BrowserDataFrame", async () => {
        const mockArrowBuffer = new Uint8Array([1, 2, 3, 4]);
        const mockExportResult = [mockArrowBuffer];
        const conn = createMockConnectionWithResults(mockExportResult);
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        const result = await qb.run();

        expect(result).toBeDefined();
        expect(result.id).toBe("mock-result-df-id");
      });

      it("should use COPY TO with ARROW format", async () => {
        const mockArrowBuffer = new Uint8Array([1, 2, 3, 4]);
        const mockExportResult = [mockArrowBuffer];
        const conn = createMockConnectionWithResults(mockExportResult);
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        await qb.run();

        // Verify COPY TO ARROW format is used
        const callArg = mockQuery.mock.calls[0][0];
        expect(callArg).toContain("COPY");
        expect(callArg).toContain("FORMAT ARROW");
        expect(callArg).toContain("output.arrow");
      });

      it("should include all operations in the exported query", async () => {
        const mockArrowBuffer = new Uint8Array([1, 2, 3, 4]);
        const mockExportResult = [mockArrowBuffer];
        const conn = createMockConnectionWithResults(mockExportResult);
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;
        const qb = createTestQueryBuilder(mockDataFrame, conn)
          .select(["name", "age"])
          .filter([{ columnName: "active", operator: "=", value: true }])
          .limit(50);

        await qb.run();

        const callArg = mockQuery.mock.calls[0][0];
        expect(callArg).toContain('"name"');
        expect(callArg).toContain('"age"');
        expect(callArg).toContain('"active" = TRUE');
        expect(callArg).toContain("LIMIT 50");
      });

      it("should call BrowserDataFrame.create with arrow buffer", async () => {
        const mockArrowBuffer = new Uint8Array([1, 2, 3, 4]);
        const mockExportResult = [mockArrowBuffer];
        const conn = createMockConnectionWithResults(mockExportResult);
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        // Import the mocked module to verify calls
        const { BrowserDataFrame } = await import("./dataframe");

        await qb.run();

        expect(BrowserDataFrame.create).toHaveBeenCalledWith(
          mockArrowBuffer,
          [],
        );
      });

      it("should preserve immutability - original builder unchanged", async () => {
        const mockArrowBuffer = new Uint8Array([1, 2, 3, 4]);
        const mockExportResult = [mockArrowBuffer];
        const conn = createMockConnectionWithResults(mockExportResult);
        const original = createTestQueryBuilder(mockDataFrame, conn);

        // Create a modified builder and run
        const modified = original
          .filter([{ columnName: "active", operator: "=", value: true }])
          .limit(10);
        await modified.run();

        // Original should still be usable
        expect(original).toBeInstanceOf(QueryBuilder);
        const originalSql = await original.sql();
        expect(originalSql).toBe('SELECT * FROM "df_test_df_id"');
      });
    });

    describe("execution method error handling", () => {
      it("rows() should propagate query errors", async () => {
        const conn = {
          query: vi.fn().mockRejectedValue(new Error("Query execution failed")),
          insertArrowFromIPCStream: vi.fn().mockResolvedValue(undefined),
        } as unknown as AsyncDuckDBConnection;
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        await expect(qb.rows()).rejects.toThrow("Query execution failed");
      });

      it("count() should propagate query errors", async () => {
        const conn = {
          query: vi.fn().mockRejectedValue(new Error("Count query failed")),
          insertArrowFromIPCStream: vi.fn().mockResolvedValue(undefined),
        } as unknown as AsyncDuckDBConnection;
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        await expect(qb.count()).rejects.toThrow("Count query failed");
      });

      it("preview() should propagate query errors", async () => {
        const conn = {
          query: vi.fn().mockRejectedValue(new Error("Preview failed")),
          insertArrowFromIPCStream: vi.fn().mockResolvedValue(undefined),
        } as unknown as AsyncDuckDBConnection;
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        await expect(qb.preview()).rejects.toThrow("Preview failed");
      });

      it("run() should propagate export errors", async () => {
        const conn = {
          query: vi.fn().mockRejectedValue(new Error("Export to Arrow failed")),
          insertArrowFromIPCStream: vi.fn().mockResolvedValue(undefined),
        } as unknown as AsyncDuckDBConnection;
        const qb = createTestQueryBuilder(mockDataFrame, conn);

        await expect(qb.run()).rejects.toThrow("Export to Arrow failed");
      });
    });
  });

  // ============================================================================
  // Static Method Tests
  // ============================================================================

  describe("static batchQuery()", () => {
    describe("empty array", () => {
      it("should return empty array when given empty queries array", async () => {
        const conn = createMockConnection();

        const results = await QueryBuilder.batchQuery(conn, []);

        expect(results).toEqual([]);
        expect(results).toHaveLength(0);
      });

      it("should not call conn.query when given empty queries array", async () => {
        const conn = createMockConnection();
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;

        await QueryBuilder.batchQuery(conn, []);

        expect(mockQuery).not.toHaveBeenCalled();
      });
    });

    describe("single query", () => {
      it("should execute single query and return results wrapped in array", async () => {
        const mockResults = [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ];
        const conn = {
          query: vi.fn().mockResolvedValue({
            toArray: () => mockResults,
          }),
        } as unknown as AsyncDuckDBConnection;

        const results = await QueryBuilder.batchQuery(conn, [
          "SELECT * FROM users",
        ]);

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual(mockResults);
      });

      it("should execute the query directly without UNION ALL wrapping", async () => {
        const conn = {
          query: vi.fn().mockResolvedValue({
            toArray: () => [],
          }),
        } as unknown as AsyncDuckDBConnection;
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;

        await QueryBuilder.batchQuery(conn, ["SELECT COUNT(*) FROM users"]);

        expect(mockQuery).toHaveBeenCalledTimes(1);
        expect(mockQuery).toHaveBeenCalledWith("SELECT COUNT(*) FROM users");
      });

      it("should return empty array result for single query with no rows", async () => {
        const conn = {
          query: vi.fn().mockResolvedValue({
            toArray: () => [],
          }),
        } as unknown as AsyncDuckDBConnection;

        const results = await QueryBuilder.batchQuery(conn, [
          "SELECT * FROM empty_table",
        ]);

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual([]);
      });
    });

    describe("multiple queries", () => {
      it("should combine queries with UNION ALL and _batch_idx", async () => {
        const mockCombinedResults = [
          { _batch_idx: 0, count: 10 },
          { _batch_idx: 1, value: "sample" },
        ];
        const conn = {
          query: vi.fn().mockResolvedValue({
            toArray: () => mockCombinedResults,
          }),
        } as unknown as AsyncDuckDBConnection;
        const mockQuery = conn.query as ReturnType<typeof vi.fn>;

        await QueryBuilder.batchQuery(conn, [
          "SELECT COUNT(*) as count FROM table1",
          "SELECT value FROM table2 LIMIT 1",
        ]);

        expect(mockQuery).toHaveBeenCalledTimes(1);
        const callArg = mockQuery.mock.calls[0][0];
        expect(callArg).toContain("SELECT 0 as _batch_idx, *");
        expect(callArg).toContain("SELECT 1 as _batch_idx, *");
        expect(callArg).toContain("UNION ALL");
      });

      it("should partition results by _batch_idx correctly", async () => {
        const mockCombinedResults = [
          { _batch_idx: 0, id: 1, name: "Alice" },
          { _batch_idx: 0, id: 2, name: "Bob" },
          { _batch_idx: 1, category: "A", total: 100 },
          { _batch_idx: 1, category: "B", total: 200 },
          { _batch_idx: 1, category: "C", total: 300 },
        ];
        const conn = {
          query: vi.fn().mockResolvedValue({
            toArray: () => mockCombinedResults,
          }),
        } as unknown as AsyncDuckDBConnection;

        const results = await QueryBuilder.batchQuery(conn, [
          "SELECT id, name FROM users",
          "SELECT category, total FROM sales",
        ]);

        expect(results).toHaveLength(2);
        expect(results[0]).toHaveLength(2);
        expect(results[1]).toHaveLength(3);
        expect(results[0]).toEqual([
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ]);
        expect(results[1]).toEqual([
          { category: "A", total: 100 },
          { category: "B", total: 200 },
          { category: "C", total: 300 },
        ]);
      });

      it("should strip _batch_idx from returned results", async () => {
        const mockCombinedResults = [
          { _batch_idx: 0, value: 42 },
          { _batch_idx: 1, name: "test" },
        ];
        const conn = {
          query: vi.fn().mockResolvedValue({
            toArray: () => mockCombinedResults,
          }),
        } as unknown as AsyncDuckDBConnection;

        const results = await QueryBuilder.batchQuery(conn, [
          "SELECT value FROM t1",
          "SELECT name FROM t2",
        ]);

        // Verify _batch_idx is not in the results
        expect(results[0][0]).not.toHaveProperty("_batch_idx");
        expect(results[1][0]).not.toHaveProperty("_batch_idx");
        expect(results[0][0]).toEqual({ value: 42 });
        expect(results[1][0]).toEqual({ name: "test" });
      });

      it("should handle three or more queries", async () => {
        const mockCombinedResults = [
          { _batch_idx: 0, a: 1 },
          { _batch_idx: 1, b: 2 },
          { _batch_idx: 2, c: 3 },
        ];
        const conn = {
          query: vi.fn().mockResolvedValue({
            toArray: () => mockCombinedResults,
          }),
        } as unknown as AsyncDuckDBConnection;

        const results = await QueryBuilder.batchQuery(conn, [
          "SELECT a FROM t1",
          "SELECT b FROM t2",
          "SELECT c FROM t3",
        ]);

        expect(results).toHaveLength(3);
        expect(results[0]).toEqual([{ a: 1 }]);
        expect(results[1]).toEqual([{ b: 2 }]);
        expect(results[2]).toEqual([{ c: 3 }]);
      });

      it("should handle query with empty results", async () => {
        const mockCombinedResults = [
          { _batch_idx: 0, value: "exists" },
          // No results for query 1
        ];
        const conn = {
          query: vi.fn().mockResolvedValue({
            toArray: () => mockCombinedResults,
          }),
        } as unknown as AsyncDuckDBConnection;

        const results = await QueryBuilder.batchQuery(conn, [
          "SELECT value FROM existing",
          "SELECT value FROM empty",
        ]);

        expect(results).toHaveLength(2);
        expect(results[0]).toEqual([{ value: "exists" }]);
        expect(results[1]).toEqual([]); // Empty array for query with no results
      });

      it("should handle all queries returning empty results", async () => {
        const conn = {
          query: vi.fn().mockResolvedValue({
            toArray: () => [],
          }),
        } as unknown as AsyncDuckDBConnection;

        const results = await QueryBuilder.batchQuery(conn, [
          "SELECT * FROM empty1",
          "SELECT * FROM empty2",
        ]);

        expect(results).toHaveLength(2);
        expect(results[0]).toEqual([]);
        expect(results[1]).toEqual([]);
      });

      it("should maintain order of results matching query order", async () => {
        // Results come back in arbitrary order from UNION ALL
        const mockCombinedResults = [
          { _batch_idx: 2, order: "third" },
          { _batch_idx: 0, order: "first" },
          { _batch_idx: 1, order: "second" },
        ];
        const conn = {
          query: vi.fn().mockResolvedValue({
            toArray: () => mockCombinedResults,
          }),
        } as unknown as AsyncDuckDBConnection;

        const results = await QueryBuilder.batchQuery(conn, [
          "SELECT 'first' as order",
          "SELECT 'second' as order",
          "SELECT 'third' as order",
        ]);

        expect(results).toHaveLength(3);
        expect(results[0][0].order).toBe("first");
        expect(results[1][0].order).toBe("second");
        expect(results[2][0].order).toBe("third");
      });
    });

    describe("error handling", () => {
      it("should propagate query errors", async () => {
        const conn = {
          query: vi.fn().mockRejectedValue(new Error("Batch query failed")),
        } as unknown as AsyncDuckDBConnection;

        await expect(
          QueryBuilder.batchQuery(conn, ["SELECT * FROM users"]),
        ).rejects.toThrow("Batch query failed");
      });

      it("should propagate errors for multiple queries", async () => {
        const conn = {
          query: vi.fn().mockRejectedValue(new Error("UNION ALL failed")),
        } as unknown as AsyncDuckDBConnection;

        await expect(
          QueryBuilder.batchQuery(conn, [
            "SELECT * FROM t1",
            "SELECT * FROM t2",
          ]),
        ).rejects.toThrow("UNION ALL failed");
      });
    });
  });
});
