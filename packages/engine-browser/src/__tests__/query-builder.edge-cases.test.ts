/**
 * Unit tests for QueryBuilder - Edge Cases
 *
 * Tests cover:
 * - Empty operations
 * - NULL value handling
 * - Special characters in identifiers
 * - Multiple filters combination
 * - Edge case value types
 */
import type { DataFrame } from "@dashframe/engine";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockConnection,
  createMockDataFrame,
  createTestQueryBuilder,
} from "./query-builder.fixtures";

describe("QueryBuilder - Edge Cases", () => {
  let mockDataFrame: DataFrame;
  let mockConn: AsyncDuckDBConnection;

  beforeEach(() => {
    mockDataFrame = createMockDataFrame();
    mockConn = createMockConnection();
    vi.clearAllMocks();
  });

  describe("empty operations", () => {
    it("should handle empty groupBy columns array", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).groupBy([]);
      const sql = await qb.sql();

      // Empty groupBy should not add GROUP BY clause
      expect(sql).toBe('SELECT * FROM "df_test_df_id"');
    });

    it("should handle groupBy with columns but empty aggregations array", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).groupBy(
        ["category"],
        [],
      );
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT "category" FROM "df_test_df_id" GROUP BY "category"',
      );
    });

    it("should handle chaining multiple empty operations", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn)
        .filter([])
        .select([])
        .sort([]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT * FROM "df_test_df_id"');
    });

    it("should handle filter with empty predicates followed by real filter", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn)
        .filter([])
        .filter([{ columnName: "age", operator: ">", value: 18 }]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT * FROM "df_test_df_id" WHERE "age" > 18');
    });
  });

  describe("NULL value handling", () => {
    it("should handle IS NULL operator correctly", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "deleted_at", operator: "IS NULL" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "deleted_at" IS NULL',
      );
    });

    it("should handle IS NOT NULL operator correctly", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "email", operator: "IS NOT NULL" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "email" IS NOT NULL',
      );
    });

    it("should handle null value with equality operator", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "value", operator: "=", value: null },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT * FROM "df_test_df_id" WHERE "value" = NULL');
    });

    it("should handle undefined value as NULL", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "value", operator: "=", value: undefined },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT * FROM "df_test_df_id" WHERE "value" = NULL');
    });

    it("should handle NULL values in IN operator values array", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        {
          columnName: "status",
          operator: "IN",
          values: ["active", null, "pending"],
        },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        "SELECT * FROM \"df_test_df_id\" WHERE \"status\" IN ('active', NULL, 'pending')",
      );
    });

    it("should handle combining NULL checks with other predicates", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "deleted_at", operator: "IS NULL" },
        { columnName: "status", operator: "=", value: "active" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "deleted_at" IS NULL AND "status" = \'active\'',
      );
    });

    it("should handle IS NULL in chained filter calls", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn)
        .filter([{ columnName: "deleted_at", operator: "IS NULL" }])
        .filter([{ columnName: "archived_at", operator: "IS NULL" }]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "deleted_at" IS NULL AND "archived_at" IS NULL',
      );
    });
  });

  describe("special characters in identifiers", () => {
    it("should quote column names with spaces", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).select([
        "first name",
        "last name",
      ]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT "first name", "last name" FROM "df_test_df_id"');
    });

    it("should escape double quotes in column names", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).select([
        'column"with"quotes',
      ]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT "column""with""quotes" FROM "df_test_df_id"');
    });

    it("should handle column names with mixed special characters", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).select([
        "user's email",
        "amount ($)",
        "date/time",
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT "user\'s email", "amount ($)", "date/time" FROM "df_test_df_id"',
      );
    });

    it("should handle column names with numeric prefixes", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).select([
        "123column",
        "99_percent",
      ]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT "123column", "99_percent" FROM "df_test_df_id"');
    });

    it("should handle column names with unicode characters", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).select([
        "名前",
        "prénom",
        "имя",
      ]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT "名前", "prénom", "имя" FROM "df_test_df_id"');
    });

    it("should escape single quotes in string filter values", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "name", operator: "=", value: "O'Brien" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        "SELECT * FROM \"df_test_df_id\" WHERE \"name\" = 'O''Brien'",
      );
    });

    it("should handle multiple single quotes in string values", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "text", operator: "=", value: "it's Tom's cat's toy" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        "SELECT * FROM \"df_test_df_id\" WHERE \"text\" = 'it''s Tom''s cat''s toy'",
      );
    });

    it("should handle special characters in IN operator string values", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        {
          columnName: "name",
          operator: "IN",
          values: ["O'Brien", "D'Angelo", "Smith"],
        },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        "SELECT * FROM \"df_test_df_id\" WHERE \"name\" IN ('O''Brien', 'D''Angelo', 'Smith')",
      );
    });

    it("should handle special characters in column names for filter", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        {
          columnName: "user email",
          operator: "=",
          value: "test@example.com",
        },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "user email" = \'test@example.com\'',
      );
    });

    it("should handle special characters in column names for sort", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).sort([
        { columnName: "created at", direction: "desc" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" ORDER BY "created at" DESC',
      );
    });

    it("should handle special characters in column names for groupBy", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).groupBy(
        ["product category"],
        [
          {
            columnName: "total amount",
            function: "sum",
            alias: "grand total",
          },
        ],
      );
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT SUM("total amount") AS "grand total", "product category" FROM "df_test_df_id" GROUP BY "product category"',
      );
    });
  });

  describe("multiple filters combination", () => {
    it("should combine multiple equality filters with AND", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "status", operator: "=", value: "active" },
        { columnName: "type", operator: "=", value: "user" },
        { columnName: "role", operator: "=", value: "admin" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "status" = \'active\' AND "type" = \'user\' AND "role" = \'admin\'',
      );
    });

    it("should combine comparison operators with equality", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "age", operator: ">=", value: 18 },
        { columnName: "age", operator: "<=", value: 65 },
        { columnName: "status", operator: "=", value: "active" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "age" >= 18 AND "age" <= 65 AND "status" = \'active\'',
      );
    });

    it("should combine IN with other operators", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        {
          columnName: "status",
          operator: "IN",
          values: ["active", "pending"],
        },
        { columnName: "age", operator: ">", value: 21 },
        { columnName: "verified", operator: "=", value: true },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "status" IN (\'active\', \'pending\') AND "age" > 21 AND "verified" = TRUE',
      );
    });

    it("should combine NOT IN with other operators", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        {
          columnName: "status",
          operator: "NOT IN",
          values: ["deleted", "banned"],
        },
        { columnName: "created_at", operator: ">=", value: "2024-01-01" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        "SELECT * FROM \"df_test_df_id\" WHERE \"status\" NOT IN ('deleted', 'banned') AND \"created_at\" >= '2024-01-01'",
      );
    });

    it("should combine IS NULL with other predicates", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "deleted_at", operator: "IS NULL" },
        { columnName: "status", operator: "=", value: "active" },
        { columnName: "age", operator: ">", value: 18 },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "deleted_at" IS NULL AND "status" = \'active\' AND "age" > 18',
      );
    });

    it("should combine IS NOT NULL with IS NULL", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "deleted_at", operator: "IS NULL" },
        { columnName: "email", operator: "IS NOT NULL" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "deleted_at" IS NULL AND "email" IS NOT NULL',
      );
    });

    it("should accumulate filters from multiple filter() calls", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn)
        .filter([{ columnName: "status", operator: "=", value: "active" }])
        .filter([{ columnName: "age", operator: ">", value: 18 }])
        .filter([{ columnName: "country", operator: "=", value: "US" }]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "status" = \'active\' AND "age" > 18 AND "country" = \'US\'',
      );
    });

    it("should handle complex combination with all filter types", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        {
          columnName: "status",
          operator: "IN",
          values: ["active", "pending"],
        },
        { columnName: "age", operator: ">=", value: 18 },
        { columnName: "age", operator: "<=", value: 65 },
        { columnName: "deleted_at", operator: "IS NULL" },
        { columnName: "email", operator: "IS NOT NULL" },
        { columnName: "country", operator: "NOT IN", values: ["XX", "YY"] },
        { columnName: "verified", operator: "=", value: true },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "status" IN (\'active\', \'pending\') AND "age" >= 18 AND "age" <= 65 AND "deleted_at" IS NULL AND "email" IS NOT NULL AND "country" NOT IN (\'XX\', \'YY\') AND "verified" = TRUE',
      );
    });

    it("should combine filters with select and sort", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn)
        .select(["name", "email", "age"])
        .filter([
          { columnName: "status", operator: "=", value: "active" },
          { columnName: "age", operator: ">=", value: 18 },
        ])
        .sort([{ columnName: "name", direction: "asc" }]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT "name", "email", "age" FROM "df_test_df_id" WHERE "status" = \'active\' AND "age" >= 18 ORDER BY "name" ASC',
      );
    });

    it("should combine filters with groupBy and aggregations", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn)
        .filter([
          { columnName: "status", operator: "=", value: "completed" },
          { columnName: "year", operator: ">=", value: 2020 },
        ])
        .groupBy(
          ["category"],
          [
            { columnName: "amount", function: "sum", alias: "total" },
            { columnName: "id", function: "count", alias: "count" },
          ],
        )
        .sort([{ columnName: "total", direction: "desc" }])
        .limit(10);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT SUM("amount") AS "total", COUNT("id") AS "count", "category" FROM "df_test_df_id" WHERE "status" = \'completed\' AND "year" >= 2020 GROUP BY "category" ORDER BY "total" DESC LIMIT 10',
      );
    });
  });

  describe("edge case value types", () => {
    it("should handle empty string value", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "name", operator: "=", value: "" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT * FROM "df_test_df_id" WHERE "name" = \'\'');
    });

    it("should handle zero as numeric value", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "balance", operator: "=", value: 0 },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT * FROM "df_test_df_id" WHERE "balance" = 0');
    });

    it("should handle negative numbers", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "temperature", operator: "<", value: -10 },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "temperature" < -10',
      );
    });

    it("should handle floating point numbers", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "price", operator: ">=", value: 19.99 },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT * FROM "df_test_df_id" WHERE "price" >= 19.99');
    });

    it("should handle false boolean value", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "active", operator: "=", value: false },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe('SELECT * FROM "df_test_df_id" WHERE "active" = FALSE');
    });

    it("should handle very long string values", async () => {
      const longString = "a".repeat(1000);
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "content", operator: "=", value: longString },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        `SELECT * FROM "df_test_df_id" WHERE "content" = '${longString}'`,
      );
    });

    it("should handle string with newlines", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "text", operator: "=", value: "line1\nline2\nline3" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "text" = \'line1\nline2\nline3\'',
      );
    });

    it("should handle string with tabs", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        { columnName: "data", operator: "=", value: "col1\tcol2\tcol3" },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "data" = \'col1\tcol2\tcol3\'',
      );
    });

    it("should handle mixed type values in IN operator", async () => {
      const qb = createTestQueryBuilder(mockDataFrame, mockConn).filter([
        {
          columnName: "value",
          operator: "IN",
          values: [1, "two", true, null],
        },
      ]);
      const sql = await qb.sql();

      expect(sql).toBe(
        'SELECT * FROM "df_test_df_id" WHERE "value" IN (1, \'two\', TRUE, NULL)',
      );
    });
  });
});
