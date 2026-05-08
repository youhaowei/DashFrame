/**
 * Unit tests for Insight class - SQL Generation
 *
 * Tests cover:
 * - Simple SELECT queries (no aggregation)
 * - WHERE clause generation
 * - ORDER BY clause generation
 * - LIMIT clause generation
 * - Combined clauses
 */
import type { DataTableField, DataTableInfo, UUID } from "@dashframe/engine";
import { beforeEach, describe, expect, it } from "vitest";
import { Insight } from "../insight";
import { createDataTableInfo, createField } from "./insight.fixtures";

describe("Insight - SQL Generation", () => {
  let baseTable: DataTableInfo;
  let fields: DataTableField[];
  let dataFrameId: string;

  beforeEach(() => {
    dataFrameId = "12345678-1234-1234-1234-123456789012";
    fields = [
      createField("Name"),
      createField("Age", { type: "number" }),
      createField("City"),
    ];
    baseTable = createDataTableInfo("users", fields, {
      dataFrameId: dataFrameId as UUID,
    });
  });

  describe("basic SELECT", () => {
    it("should generate SELECT with all columns from base table", () => {
      const insight = new Insight({
        name: "Simple Query",
        baseTable,
      });

      const sql = insight.toSQL();

      const expectedTableName = `df_${dataFrameId.replace(/-/g, "_")}`;
      expect(sql).toContain("SELECT");
      expect(sql).toContain(`FROM ${expectedTableName}`);
      expect(sql).toContain('"name"');
      expect(sql).toContain('"age"');
      expect(sql).toContain('"city"');
    });

    it("should throw error when dataFrameId is missing", () => {
      const tableWithoutData = createDataTableInfo("empty_table", fields, {
        dataFrameId: undefined,
      });
      const insight = new Insight({
        name: "No Data Query",
        baseTable: tableWithoutData,
      });

      expect(() => insight.toSQL()).toThrow(
        "Base DataTable empty_table has no cached data. Load data first.",
      );
    });

    it("should exclude fields starting with underscore", () => {
      const fieldsWithInternal = [
        createField("Name"),
        createField("_internal", { columnName: "_internal" }),
        createField("City"),
      ];
      const tableWithInternal = createDataTableInfo(
        "users",
        fieldsWithInternal,
        {
          dataFrameId: dataFrameId as UUID,
        },
      );
      const insight = new Insight({
        name: "Query Without Internal",
        baseTable: tableWithInternal,
      });

      const sql = insight.toSQL();

      expect(sql).toContain('"name"');
      expect(sql).toContain('"city"');
      expect(sql).not.toContain('"_internal"');
    });
  });

  describe("WHERE clause", () => {
    it("should generate WHERE with equals operator", () => {
      const insight = new Insight({
        name: "Filter Query",
        baseTable,
        filters: [{ columnName: "city", operator: "=", value: "New York" }],
      });

      const sql = insight.toSQL();

      expect(sql).toContain("WHERE");
      expect(sql).toContain(`"city" = 'New York'`);
    });

    it("should generate WHERE with numeric comparison operators", () => {
      const insight = new Insight({
        name: "Numeric Filter Query",
        baseTable,
        filters: [{ columnName: "age", operator: ">=", value: 21 }],
      });

      const sql = insight.toSQL();

      expect(sql).toContain(`"age" >= 21`);
    });

    it("should generate WHERE with greater than operator", () => {
      const insight = new Insight({
        name: "Greater Than Query",
        baseTable,
        filters: [{ columnName: "age", operator: ">", value: 18 }],
      });

      const sql = insight.toSQL();

      expect(sql).toContain(`"age" > 18`);
    });

    it("should generate WHERE with less than operator", () => {
      const insight = new Insight({
        name: "Less Than Query",
        baseTable,
        filters: [{ columnName: "age", operator: "<", value: 65 }],
      });

      const sql = insight.toSQL();

      expect(sql).toContain(`"age" < 65`);
    });

    it("should generate WHERE with less than or equal operator", () => {
      const insight = new Insight({
        name: "Less Than Equal Query",
        baseTable,
        filters: [{ columnName: "age", operator: "<=", value: 30 }],
      });

      const sql = insight.toSQL();

      expect(sql).toContain(`"age" <= 30`);
    });

    it("should generate WHERE with IS NULL operator", () => {
      const insight = new Insight({
        name: "Null Check Query",
        baseTable,
        filters: [{ columnName: "city", operator: "IS NULL" }],
      });

      const sql = insight.toSQL();

      expect(sql).toContain(`"city" IS NULL`);
    });

    it("should generate WHERE with IS NOT NULL operator", () => {
      const insight = new Insight({
        name: "Not Null Check Query",
        baseTable,
        filters: [{ columnName: "city", operator: "IS NOT NULL" }],
      });

      const sql = insight.toSQL();

      expect(sql).toContain(`"city" IS NOT NULL`);
    });

    it("should generate WHERE with IN operator for strings", () => {
      const insight = new Insight({
        name: "In List Query",
        baseTable,
        filters: [
          {
            columnName: "city",
            operator: "IN",
            values: ["New York", "Los Angeles", "Chicago"],
          },
        ],
      });

      const sql = insight.toSQL();

      expect(sql).toContain(`"city" IN ('New York', 'Los Angeles', 'Chicago')`);
    });

    it("should generate WHERE with IN operator for numbers", () => {
      const insight = new Insight({
        name: "In Numbers Query",
        baseTable,
        filters: [
          {
            columnName: "age",
            operator: "IN",
            values: [18, 21, 25],
          },
        ],
      });

      const sql = insight.toSQL();

      expect(sql).toContain(`"age" IN (18, 21, 25)`);
    });

    it("should generate WHERE with NOT IN operator", () => {
      const insight = new Insight({
        name: "Not In Query",
        baseTable,
        filters: [
          {
            columnName: "city",
            operator: "NOT IN",
            values: ["Unknown", "N/A"],
          },
        ],
      });

      const sql = insight.toSQL();

      expect(sql).toContain(`"city" NOT IN ('Unknown', 'N/A')`);
    });

    it("should combine multiple filters with AND", () => {
      const insight = new Insight({
        name: "Multiple Filters Query",
        baseTable,
        filters: [
          { columnName: "age", operator: ">=", value: 18 },
          { columnName: "city", operator: "=", value: "New York" },
        ],
      });

      const sql = insight.toSQL();

      expect(sql).toContain("WHERE");
      expect(sql).toContain(`"age" >= 18`);
      expect(sql).toContain(" AND ");
      expect(sql).toContain(`"city" = 'New York'`);
    });
  });

  describe("ORDER BY clause", () => {
    it("should generate ORDER BY with ascending direction", () => {
      const insight = new Insight({
        name: "Ordered Query",
        baseTable,
        orderBy: [{ columnName: "name", direction: "asc" }],
      });

      const sql = insight.toSQL();

      expect(sql).toContain('ORDER BY "name" ASC');
    });

    it("should generate ORDER BY with descending direction", () => {
      const insight = new Insight({
        name: "Descending Query",
        baseTable,
        orderBy: [{ columnName: "age", direction: "desc" }],
      });

      const sql = insight.toSQL();

      expect(sql).toContain('ORDER BY "age" DESC');
    });

    it("should generate ORDER BY with multiple columns", () => {
      const insight = new Insight({
        name: "Multi-Order Query",
        baseTable,
        orderBy: [
          { columnName: "city", direction: "asc" },
          { columnName: "age", direction: "desc" },
        ],
      });

      const sql = insight.toSQL();

      expect(sql).toContain('ORDER BY "city" ASC, "age" DESC');
    });
  });

  describe("LIMIT clause", () => {
    it("should generate LIMIT clause when specified", () => {
      const insight = new Insight({
        name: "Limited Query",
        baseTable,
        limit: 100,
      });

      const sql = insight.toSQL();

      expect(sql).toContain("LIMIT 100");
    });

    it("should not include LIMIT when not specified", () => {
      const insight = new Insight({
        name: "Unlimited Query",
        baseTable,
      });

      const sql = insight.toSQL();

      expect(sql).not.toContain("LIMIT");
    });

    it("should handle limit of 1", () => {
      const insight = new Insight({
        name: "Single Row Query",
        baseTable,
        limit: 1,
      });

      const sql = insight.toSQL();

      expect(sql).toContain("LIMIT 1");
    });

    it("should handle limit of 0", () => {
      const insight = new Insight({
        name: "Zero Limit Query",
        baseTable,
        limit: 0,
      });

      const sql = insight.toSQL();

      // limit: 0 is falsy but should still be included in the SQL
      expect(sql).toContain("LIMIT 0");
    });
  });

  describe("combined clauses", () => {
    it("should generate SQL with WHERE, ORDER BY, and LIMIT", () => {
      const insight = new Insight({
        name: "Full Query",
        baseTable,
        filters: [{ columnName: "age", operator: ">=", value: 18 }],
        orderBy: [{ columnName: "name", direction: "asc" }],
        limit: 50,
      });

      const sql = insight.toSQL();

      const expectedTableName = `df_${dataFrameId.replace(/-/g, "_")}`;
      expect(sql).toContain(`FROM ${expectedTableName}`);
      expect(sql).toContain(`WHERE "age" >= 18`);
      expect(sql).toContain('ORDER BY "name" ASC');
      expect(sql).toContain("LIMIT 50");

      // Verify clause order: WHERE before ORDER BY before LIMIT
      const whereIdx = sql.indexOf("WHERE");
      const orderByIdx = sql.indexOf("ORDER BY");
      const limitIdx = sql.indexOf("LIMIT");
      expect(whereIdx).toBeLessThan(orderByIdx);
      expect(orderByIdx).toBeLessThan(limitIdx);
    });

    it("should generate SQL with multiple filters and ORDER BY", () => {
      const insight = new Insight({
        name: "Complex Query",
        baseTable,
        filters: [
          { columnName: "age", operator: ">=", value: 21 },
          { columnName: "city", operator: "!=", value: "Unknown" },
        ],
        orderBy: [
          { columnName: "city", direction: "asc" },
          { columnName: "age", direction: "desc" },
        ],
      });

      const sql = insight.toSQL();

      expect(sql).toContain(`"age" >= 21`);
      expect(sql).toContain(`"city" != 'Unknown'`);
      expect(sql).toContain('ORDER BY "city" ASC, "age" DESC');
    });

    it("should generate SQL with only ORDER BY and LIMIT", () => {
      const insight = new Insight({
        name: "Ordered Limited Query",
        baseTable,
        orderBy: [{ columnName: "age", direction: "desc" }],
        limit: 10,
      });

      const sql = insight.toSQL();

      expect(sql).not.toContain("WHERE");
      expect(sql).toContain('ORDER BY "age" DESC');
      expect(sql).toContain("LIMIT 10");
    });

    it("should generate SQL with only WHERE and LIMIT", () => {
      const insight = new Insight({
        name: "Filtered Limited Query",
        baseTable,
        filters: [{ columnName: "city", operator: "=", value: "Boston" }],
        limit: 25,
      });

      const sql = insight.toSQL();

      expect(sql).toContain(`"city" = 'Boston'`);
      expect(sql).not.toContain("ORDER BY");
      expect(sql).toContain("LIMIT 25");
    });
  });
});
