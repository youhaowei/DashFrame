/**
 * Unit tests for QueryBuilder - SQL Generation
 *
 * Tests cover:
 * - sql() and toSQL() methods
 * - Basic SELECT queries
 * - WHERE clause generation (formatPredicate)
 * - ORDER BY clause generation (buildOrderClause)
 * - GROUP BY clause generation (buildSelectClause with groups)
 * - LIMIT and OFFSET clause generation
 * - Complex query generation (buildPlan)
 * - Edge cases for SQL generation
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { DataFrame } from "@dashframe/engine";
import {
  createMockDataFrame,
  createMockConnection,
  createTestQueryBuilder,
} from "./query-builder.fixtures";

describe("QueryBuilder - SQL Generation", () => {
  let mockDataFrame: DataFrame;
  let mockConn: AsyncDuckDBConnection;

  beforeEach(() => {
    mockDataFrame = createMockDataFrame();
    mockConn = createMockConnection();
    vi.clearAllMocks();
  });

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
        'SELECT * FROM "df_test_df_id" WHERE "status" = \'active\'',
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

      expect(sql).toBe('SELECT * FROM "df_test_df_id" WHERE "id" IN (1, 2, 3)');
    });

    it("should format boolean values", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "active", operator: "=", value: true },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT * FROM "df_test_df_id" WHERE "active" = TRUE');
    });

    it("should format NULL values", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "value", operator: "=", value: null },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT * FROM "df_test_df_id" WHERE "value" = NULL');
    });

    it("should join multiple predicates with AND", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "age", operator: ">", value: 18 },
        { columnName: "status", operator: "=", value: "active" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "age" > 18 AND "status" = \'active\'',
      );
    });

    it("should accumulate predicates from multiple filter calls", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn)
        .filter([{ columnName: "age", operator: ">", value: 18 }])
        .filter([{ columnName: "country", operator: "=", value: "US" }]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "age" > 18 AND "country" = \'US\'',
      );
    });
  });

  describe("ORDER BY clause generation (buildOrderClause)", () => {
    it("should generate ORDER BY with ASC", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).sort([
        { columnName: "name", direction: "asc" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT * FROM "df_test_df_id" ORDER BY "name" ASC');
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

      expect(sql).toBe('SELECT * FROM "df_test_df_id" ORDER BY "age" DESC');
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
        .groupBy(
          ["category"],
          [{ columnName: "amount", function: "sum", alias: "total" }],
        )
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
        .groupBy(
          ["category"],
          [{ columnName: "amount", function: "sum", alias: "total_amount" }],
        )
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
        .groupBy(
          ["category"],
          [{ columnName: "amount", function: "sum", alias: "total" }],
        )
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
        {
          columnName: "id",
          operator: "=",
          value: BigInt("9007199254740993"),
        },
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
