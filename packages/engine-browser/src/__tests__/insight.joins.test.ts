/**
 * Unit tests for Insight class - JOIN SQL Generation
 *
 * Tests cover:
 * - Basic JOIN generation (INNER, LEFT, RIGHT, OUTER)
 * - Field aliasing for duplicate columns
 * - JOIN with aggregation
 * - JOIN with WHERE, ORDER BY, LIMIT clauses
 * - JOIN error handling
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Insight } from "../insight";
import type { DataTableInfo, DataTableField, UUID } from "@dashframe/engine";
import { createField, createDataTableInfo } from "./insight.fixtures";

describe("Insight - JOIN SQL Generation", () => {
  let usersTable: DataTableInfo;
  let ordersTable: DataTableInfo;
  let userFields: DataTableField[];
  let orderFields: DataTableField[];
  let usersDataFrameId: string;
  let ordersDataFrameId: string;

  beforeEach(() => {
    usersDataFrameId = "11111111-1111-1111-1111-111111111111";
    ordersDataFrameId = "22222222-2222-2222-2222-222222222222";

    userFields = [
      createField("UserId", { columnName: "user_id" }),
      createField("Name", { columnName: "name" }),
      createField("Email", { columnName: "email" }),
    ];
    usersTable = createDataTableInfo("users", userFields, {
      dataFrameId: usersDataFrameId as UUID,
    });

    orderFields = [
      createField("OrderId", { columnName: "order_id" }),
      createField("UserId", { columnName: "user_id" }),
      createField("Amount", { columnName: "amount", type: "number" }),
      createField("Status", { columnName: "status" }),
    ];
    ordersTable = createDataTableInfo("orders", orderFields, {
      dataFrameId: ordersDataFrameId as UUID,
    });
  });

  describe("basic JOIN generation", () => {
    it("should generate INNER JOIN query", () => {
      const insight = new Insight({
        name: "Users with Orders",
        baseTable: usersTable,
        joins: [
          {
            table: ordersTable,
            selectedFields: [orderFields[2].id],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "inner",
          },
        ],
      });

      const sql = insight.toSQL();

      expect(sql).toContain("INNER JOIN");
      expect(sql).toContain(`ON base."user_id" = j."user_id"`);
    });

    it("should generate LEFT JOIN query", () => {
      const insight = new Insight({
        name: "All Users with Optional Orders",
        baseTable: usersTable,
        joins: [
          {
            table: ordersTable,
            selectedFields: [orderFields[2].id],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "left",
          },
        ],
      });

      const sql = insight.toSQL();

      expect(sql).toContain("LEFT JOIN");
      expect(sql).toContain(`ON base."user_id" = j."user_id"`);
    });

    it("should generate RIGHT JOIN query", () => {
      const insight = new Insight({
        name: "All Orders with Optional Users",
        baseTable: usersTable,
        joins: [
          {
            table: ordersTable,
            selectedFields: [orderFields[2].id],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "right",
          },
        ],
      });

      const sql = insight.toSQL();

      expect(sql).toContain("RIGHT JOIN");
    });

    it("should generate OUTER JOIN query", () => {
      const insight = new Insight({
        name: "All Users and Orders",
        baseTable: usersTable,
        joins: [
          {
            table: ordersTable,
            selectedFields: [orderFields[2].id],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "outer",
          },
        ],
      });

      const sql = insight.toSQL();

      expect(sql).toContain("OUTER JOIN");
    });

    it("should use correct table aliases in JOIN", () => {
      const insight = new Insight({
        name: "Join with Aliases",
        baseTable: usersTable,
        joins: [
          {
            table: ordersTable,
            selectedFields: [],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "inner",
          },
        ],
      });

      const sql = insight.toSQL();

      // Verify table aliases are used
      expect(sql).toContain("AS base");
      expect(sql).toContain("AS j");
    });
  });

  describe("field aliasing for duplicate columns", () => {
    it("should alias duplicate columns with table name prefix", () => {
      // Create tables with same column name
      const tableAFields = [
        createField("Id", { columnName: "id" }),
        createField("Name", { columnName: "name" }),
      ];
      const tableA = createDataTableInfo("customers", tableAFields, {
        dataFrameId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" as UUID,
      });

      const tableBFields = [
        createField("Id", { columnName: "id" }),
        createField("Name", { columnName: "name" }), // Same column name
        createField("CustomerId", { columnName: "customer_id" }),
      ];
      const tableB = createDataTableInfo("products", tableBFields, {
        dataFrameId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" as UUID,
      });

      const insight = new Insight({
        name: "Duplicate Columns",
        baseTable: tableA,
        joins: [
          {
            table: tableB,
            selectedFields: [],
            joinOn: {
              baseField: tableAFields[0].id,
              joinedField: tableBFields[2].id,
            },
            joinType: "inner",
          },
        ],
      });

      const sql = insight.toSQL();

      // Duplicate columns should be aliased with table name prefix
      expect(sql).toContain('AS "customers.name"');
      expect(sql).toContain('AS "products.name"');
      expect(sql).toContain('AS "products.id"');
    });

    it("should not alias the join key column in base table", () => {
      const insight = new Insight({
        name: "Join Key Not Aliased",
        baseTable: usersTable,
        joins: [
          {
            table: ordersTable,
            selectedFields: [],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "inner",
          },
        ],
      });

      const sql = insight.toSQL();

      // The join key (user_id) in base table should not get table prefix alias
      // even though it exists in both tables
      expect(sql).toContain('base."user_id"');
      // Join table's user_id should be aliased
      expect(sql).toContain('AS "orders.user_id"');
    });

    it("should handle tables with auto-generated names containing UUIDs", () => {
      const autoNamedTable = createDataTableInfo(
        "data_12345678-1234-1234-1234-123456789012.csv",
        [
          createField("Id", { columnName: "id" }),
          createField("Value", { columnName: "value" }),
        ],
        { dataFrameId: "cccccccc-cccc-cccc-cccc-cccccccccccc" as UUID },
      );

      const baseFields = [
        createField("Id", { columnName: "id" }),
        createField("RefId", { columnName: "ref_id" }),
      ];
      const baseTable = createDataTableInfo("base_table", baseFields, {
        dataFrameId: "dddddddd-dddd-dddd-dddd-dddddddddddd" as UUID,
      });

      const insight = new Insight({
        name: "Auto-named Table Join",
        baseTable: baseTable,
        joins: [
          {
            table: autoNamedTable,
            selectedFields: [],
            joinOn: {
              baseField: baseFields[1].id,
              joinedField: autoNamedTable.fields[0].id,
            },
            joinType: "left",
          },
        ],
      });

      const sql = insight.toSQL();

      // UUID should be stripped from display name in alias
      expect(sql).toContain('AS "data.id"');
      expect(sql).not.toContain("12345678-1234-1234-1234-123456789012");
    });

    it("should preserve unique columns without aliasing", () => {
      const insight = new Insight({
        name: "Unique Columns",
        baseTable: usersTable,
        joins: [
          {
            table: ordersTable,
            selectedFields: [],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "inner",
          },
        ],
      });

      const sql = insight.toSQL();

      // Unique columns should not have table prefix
      expect(sql).toContain('base."name"');
      expect(sql).toContain('base."email"');
      expect(sql).toContain('j."order_id"');
      expect(sql).toContain('j."amount"');
      expect(sql).toContain('j."status"');
    });
  });

  describe("JOIN with aggregation", () => {
    it("should generate aggregated JOIN query with selected fields", () => {
      const insight = new Insight({
        name: "Aggregated Join",
        baseTable: usersTable,
        selectedFields: [userFields[1].id],
        joins: [
          {
            table: ordersTable,
            selectedFields: [],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "left",
          },
        ],
        metrics: [
          {
            id: crypto.randomUUID() as UUID,
            name: "Total Amount",
            sourceTable: ordersTable.id,
            aggregation: "sum",
            columnName: "amount",
          },
        ],
      });

      const sql = insight.toSQL();

      expect(sql).toContain('"name"');
      expect(sql).toContain('SUM("amount") AS "Total Amount"');
      expect(sql).toContain('GROUP BY "name"');
    });

    it("should handle COUNT aggregation in JOIN", () => {
      const insight = new Insight({
        name: "Count Join",
        baseTable: usersTable,
        selectedFields: [userFields[1].id],
        joins: [
          {
            table: ordersTable,
            selectedFields: [],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "left",
          },
        ],
        metrics: [
          {
            id: crypto.randomUUID() as UUID,
            name: "Order Count",
            sourceTable: ordersTable.id,
            aggregation: "count",
          },
        ],
      });

      const sql = insight.toSQL();

      expect(sql).toContain('COUNT(*) AS "Order Count"');
    });

    it("should handle AVG aggregation with aliased column", () => {
      // Create tables with duplicate 'value' column
      const tableA = createDataTableInfo(
        "sales",
        [
          createField("Id", { columnName: "id" }),
          createField("Value", { columnName: "value", type: "number" }),
        ],
        { dataFrameId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" as UUID },
      );

      const tableB = createDataTableInfo(
        "targets",
        [
          createField("Id", { columnName: "id" }),
          createField("Value", { columnName: "value", type: "number" }),
          createField("SalesId", { columnName: "sales_id" }),
        ],
        { dataFrameId: "ffffffff-ffff-ffff-ffff-ffffffffffff" as UUID },
      );

      const insight = new Insight({
        name: "Avg with Alias",
        baseTable: tableA,
        selectedFields: [tableA.fields[0].id],
        joins: [
          {
            table: tableB,
            selectedFields: [],
            joinOn: {
              baseField: tableA.fields[0].id,
              joinedField: tableB.fields[2].id,
            },
            joinType: "inner",
          },
        ],
        metrics: [
          {
            id: crypto.randomUUID() as UUID,
            name: "Avg Target",
            sourceTable: tableB.id,
            aggregation: "avg",
            columnName: "value",
          },
        ],
      });

      const sql = insight.toSQL();

      // The 'value' column from targets should be aliased
      expect(sql).toContain("AVG");
      expect(sql).toContain('AS "Avg Target"');
    });

    it("should handle multiple metrics in JOIN", () => {
      const insight = new Insight({
        name: "Multiple Metrics",
        baseTable: usersTable,
        selectedFields: [userFields[1].id],
        joins: [
          {
            table: ordersTable,
            selectedFields: [],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "left",
          },
        ],
        metrics: [
          {
            id: crypto.randomUUID() as UUID,
            name: "Total Amount",
            sourceTable: ordersTable.id,
            aggregation: "sum",
            columnName: "amount",
          },
          {
            id: crypto.randomUUID() as UUID,
            name: "Order Count",
            sourceTable: ordersTable.id,
            aggregation: "count",
          },
          {
            id: crypto.randomUUID() as UUID,
            name: "Avg Order",
            sourceTable: ordersTable.id,
            aggregation: "avg",
            columnName: "amount",
          },
        ],
      });

      const sql = insight.toSQL();

      expect(sql).toContain('SUM("amount") AS "Total Amount"');
      expect(sql).toContain('COUNT(*) AS "Order Count"');
      expect(sql).toContain('AVG("amount") AS "Avg Order"');
    });
  });

  describe("JOIN with clauses", () => {
    it("should generate JOIN with WHERE clause", () => {
      const insight = new Insight({
        name: "Filtered Join",
        baseTable: usersTable,
        joins: [
          {
            table: ordersTable,
            selectedFields: [],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "inner",
          },
        ],
        filters: [{ columnName: "status", operator: "=", value: "completed" }],
      });

      const sql = insight.toSQL();

      expect(sql).toContain("WHERE");
      expect(sql).toContain(`"status" = 'completed'`);
    });

    it("should generate JOIN with ORDER BY clause", () => {
      const insight = new Insight({
        name: "Ordered Join",
        baseTable: usersTable,
        joins: [
          {
            table: ordersTable,
            selectedFields: [],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "inner",
          },
        ],
        orderBy: [{ columnName: "amount", direction: "desc" }],
      });

      const sql = insight.toSQL();

      expect(sql).toContain('ORDER BY "amount" DESC');
    });

    it("should generate JOIN with LIMIT clause", () => {
      const insight = new Insight({
        name: "Limited Join",
        baseTable: usersTable,
        joins: [
          {
            table: ordersTable,
            selectedFields: [],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "inner",
          },
        ],
        limit: 100,
      });

      const sql = insight.toSQL();

      expect(sql).toContain("LIMIT 100");
    });

    it("should generate JOIN with all clauses combined", () => {
      const insight = new Insight({
        name: "Full Join Query",
        baseTable: usersTable,
        joins: [
          {
            table: ordersTable,
            selectedFields: [],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "left",
          },
        ],
        filters: [{ columnName: "amount", operator: ">", value: 100 }],
        orderBy: [{ columnName: "amount", direction: "desc" }],
        limit: 50,
      });

      const sql = insight.toSQL();

      expect(sql).toContain("LEFT JOIN");
      expect(sql).toContain(`"amount" > 100`);
      expect(sql).toContain('ORDER BY "amount" DESC');
      expect(sql).toContain("LIMIT 50");

      // Verify clause order
      const whereIdx = sql.indexOf("WHERE");
      const orderByIdx = sql.indexOf("ORDER BY");
      const limitIdx = sql.indexOf("LIMIT");
      expect(whereIdx).toBeLessThan(orderByIdx);
      expect(orderByIdx).toBeLessThan(limitIdx);
    });
  });

  describe("JOIN error handling", () => {
    it("should throw error when join table has no dataFrameId", () => {
      const tableWithoutData = createDataTableInfo(
        "empty_orders",
        orderFields,
        { dataFrameId: undefined },
      );

      const insight = new Insight({
        name: "Invalid Join",
        baseTable: usersTable,
        joins: [
          {
            table: tableWithoutData,
            selectedFields: [],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "inner",
          },
        ],
      });

      expect(() => insight.toSQL()).toThrow(
        "Join table empty_orders has no data",
      );
    });

    it("should throw error when base join key field not found", () => {
      const insight = new Insight({
        name: "Invalid Base Key",
        baseTable: usersTable,
        joins: [
          {
            table: ordersTable,
            selectedFields: [],
            joinOn: {
              baseField: "nonexistent-field-id" as UUID,
              joinedField: orderFields[1].id,
            },
            joinType: "inner",
          },
        ],
      });

      expect(() => insight.toSQL()).toThrow("Join key fields not found");
    });

    it("should throw error when join key field not found", () => {
      const insight = new Insight({
        name: "Invalid Join Key",
        baseTable: usersTable,
        joins: [
          {
            table: ordersTable,
            selectedFields: [],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: "nonexistent-field-id" as UUID,
            },
            joinType: "inner",
          },
        ],
      });

      expect(() => insight.toSQL()).toThrow("Join key fields not found");
    });
  });

  describe("non-aggregated JOIN", () => {
    it("should generate SELECT * for non-aggregated JOIN", () => {
      const insight = new Insight({
        name: "Simple Join Select All",
        baseTable: usersTable,
        joins: [
          {
            table: ordersTable,
            selectedFields: [],
            joinOn: {
              baseField: userFields[0].id,
              joinedField: orderFields[1].id,
            },
            joinType: "inner",
          },
        ],
      });

      const sql = insight.toSQL();

      expect(sql).toContain("SELECT *");
      expect(sql).toContain("FROM (");
      expect(sql).not.toContain("GROUP BY");
    });
  });
});
