/**
 * Unit tests for Insight class
 *
 * Tests cover:
 * - Constructor validation
 * - Property accessors
 * - DataTableInfo and InsightConfiguration fixtures
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Insight, type InsightConfiguration } from "./insight";
import type { DataTableInfo, DataTableField, UUID } from "@dashframe/engine";

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a valid DataTableField for testing.
 */
function createField(
  name: string,
  overrides?: Partial<DataTableField>,
): DataTableField {
  return {
    id: crypto.randomUUID() as UUID,
    name,
    columnName: overrides?.columnName ?? name.toLowerCase().replace(/ /g, "_"),
    type: overrides?.type ?? "string",
    ...overrides,
  };
}

/**
 * Creates a valid DataTableInfo for testing.
 */
function createDataTableInfo(
  name: string,
  fields: DataTableField[],
  overrides?: Partial<DataTableInfo>,
): DataTableInfo {
  return {
    id: crypto.randomUUID() as UUID,
    name,
    dataFrameId: crypto.randomUUID() as UUID,
    fields,
    ...overrides,
  };
}

/**
 * Creates a minimal valid InsightConfiguration for testing.
 */
function createInsightConfig(
  overrides?: Partial<InsightConfiguration>,
): InsightConfiguration {
  const fields = [
    createField("Name"),
    createField("Age"),
    createField("City"),
  ];
  const baseTable = createDataTableInfo("users", fields);

  return {
    name: "Test Insight",
    baseTable,
    ...overrides,
  };
}

// ============================================================================
// Test Suite: Insight Class
// ============================================================================

describe("Insight", () => {
  let baseTable: DataTableInfo;
  let fields: DataTableField[];

  beforeEach(() => {
    fields = [
      createField("Name"),
      createField("Age", { type: "number" }),
      createField("City"),
    ];
    baseTable = createDataTableInfo("users", fields);
  });

  describe("constructor", () => {
    it("should create an Insight with valid configuration", () => {
      const config = createInsightConfig({ baseTable });

      const insight = new Insight(config);

      expect(insight).toBeInstanceOf(Insight);
      expect(insight.name).toBe("Test Insight");
      expect(insight.baseTable).toBe(baseTable);
    });

    it("should generate an ID if not provided", () => {
      const config = createInsightConfig({ baseTable });

      const insight = new Insight(config);

      expect(insight.id).toBeDefined();
      expect(typeof insight.id).toBe("string");
      expect(insight.id.length).toBeGreaterThan(0);
    });

    it("should use provided ID when given", () => {
      const customId = "custom-uuid-1234" as UUID;
      const config = createInsightConfig({
        baseTable,
        id: customId,
      });

      const insight = new Insight(config);

      expect(insight.id).toBe(customId);
    });

    it("should throw error when name is missing", () => {
      const config = createInsightConfig({ baseTable });
      // @ts-expect-error - Testing runtime validation
      config.name = "";

      expect(() => new Insight(config)).toThrow("Insight must have a name");
    });

    it("should throw error when name is undefined", () => {
      const config = createInsightConfig({ baseTable });
      // @ts-expect-error - Testing runtime validation
      config.name = undefined;

      expect(() => new Insight(config)).toThrow("Insight must have a name");
    });

    it("should throw error when baseTable is missing", () => {
      const config = createInsightConfig();
      // @ts-expect-error - Testing runtime validation
      config.baseTable = undefined;

      expect(() => new Insight(config)).toThrow(
        "Insight must have a baseTable",
      );
    });

    it("should throw error when baseTable is null", () => {
      const config = createInsightConfig();
      // @ts-expect-error - Testing runtime validation
      config.baseTable = null;

      expect(() => new Insight(config)).toThrow(
        "Insight must have a baseTable",
      );
    });

    it("should initialize arrays to empty if not provided", () => {
      const config: InsightConfiguration = {
        name: "Minimal Insight",
        baseTable,
      };

      const insight = new Insight(config);

      expect(insight.selectedFields).toEqual([]);
      expect(insight.metrics).toEqual([]);
      expect(insight.filters).toEqual([]);
      expect(insight.groupBy).toEqual([]);
      expect(insight.orderBy).toEqual([]);
      expect(insight.joins).toEqual([]);
    });

    it("should preserve provided optional arrays", () => {
      const config = createInsightConfig({
        baseTable,
        selectedFields: [fields[0].id],
        groupBy: ["city"],
        filters: [{ columnName: "age", operator: ">", value: 18 }],
        orderBy: [{ columnName: "name", direction: "asc" }],
        limit: 100,
      });

      const insight = new Insight(config);

      expect(insight.selectedFields).toEqual([fields[0].id]);
      expect(insight.groupBy).toEqual(["city"]);
      expect(insight.filters).toEqual([
        { columnName: "age", operator: ">", value: 18 },
      ]);
      expect(insight.orderBy).toEqual([{ columnName: "name", direction: "asc" }]);
      expect(insight.limit).toBe(100);
    });
  });

  describe("property accessors", () => {
    let insight: Insight;

    beforeEach(() => {
      const config = createInsightConfig({
        baseTable,
        selectedFields: [fields[0].id, fields[1].id],
        metrics: [
          {
            id: crypto.randomUUID() as UUID,
            name: "Total Count",
            sourceTable: baseTable.id,
            aggregation: "count",
          },
        ],
        filters: [{ columnName: "age", operator: ">=", value: 21 }],
        groupBy: ["city"],
        orderBy: [{ columnName: "age", direction: "desc" }],
        limit: 50,
      });
      insight = new Insight(config);
    });

    it("should return id", () => {
      expect(insight.id).toBeDefined();
      expect(typeof insight.id).toBe("string");
    });

    it("should return name", () => {
      expect(insight.name).toBe("Test Insight");
    });

    it("should return baseTable", () => {
      expect(insight.baseTable).toBe(baseTable);
      expect(insight.baseTable.name).toBe("users");
      expect(insight.baseTable.fields).toHaveLength(3);
    });

    it("should return selectedFields", () => {
      expect(insight.selectedFields).toHaveLength(2);
      expect(insight.selectedFields).toContain(fields[0].id);
      expect(insight.selectedFields).toContain(fields[1].id);
    });

    it("should return metrics", () => {
      expect(insight.metrics).toHaveLength(1);
      expect(insight.metrics[0].name).toBe("Total Count");
      expect(insight.metrics[0].aggregation).toBe("count");
    });

    it("should return filters", () => {
      expect(insight.filters).toHaveLength(1);
      expect(insight.filters[0]).toEqual({
        columnName: "age",
        operator: ">=",
        value: 21,
      });
    });

    it("should return groupBy", () => {
      expect(insight.groupBy).toEqual(["city"]);
    });

    it("should return orderBy", () => {
      expect(insight.orderBy).toHaveLength(1);
      expect(insight.orderBy[0]).toEqual({
        columnName: "age",
        direction: "desc",
      });
    });

    it("should return limit", () => {
      expect(insight.limit).toBe(50);
    });

    it("should return undefined limit when not set", () => {
      const config = createInsightConfig({ baseTable });
      const insightWithoutLimit = new Insight(config);

      expect(insightWithoutLimit.limit).toBeUndefined();
    });

    it("should return joins array", () => {
      expect(insight.joins).toEqual([]);
    });

    it("should return config as a copy", () => {
      const config = insight.config;

      expect(config).toBeDefined();
      expect(config.name).toBe("Test Insight");
      expect(config.baseTable).toBe(baseTable);
      // Should be a copy, not the same reference
      expect(config).not.toBe(insight.config);
    });
  });

  describe("DataTableInfo fixture", () => {
    it("should have required fields", () => {
      expect(baseTable.id).toBeDefined();
      expect(baseTable.name).toBe("users");
      expect(baseTable.dataFrameId).toBeDefined();
      expect(baseTable.fields).toHaveLength(3);
    });

    it("should have valid field structure", () => {
      const field = baseTable.fields[0];

      expect(field.id).toBeDefined();
      expect(field.name).toBe("Name");
      expect(field.columnName).toBe("name");
      expect(field.type).toBe("string");
    });

    it("should create DataTableInfo without dataFrameId", () => {
      const tableWithoutData = createDataTableInfo("empty_table", fields, {
        dataFrameId: undefined,
      });

      expect(tableWithoutData.dataFrameId).toBeUndefined();
    });
  });

  describe("InsightConfiguration fixture", () => {
    it("should create valid minimal configuration", () => {
      const config = createInsightConfig();

      expect(config.name).toBe("Test Insight");
      expect(config.baseTable).toBeDefined();
      expect(config.baseTable.fields).toBeDefined();
    });

    it("should allow overriding any property", () => {
      const customTable = createDataTableInfo("products", [
        createField("Product Name"),
        createField("Price", { type: "number" }),
      ]);

      const config = createInsightConfig({
        name: "Custom Insight",
        baseTable: customTable,
        limit: 25,
      });

      expect(config.name).toBe("Custom Insight");
      expect(config.baseTable.name).toBe("products");
      expect(config.limit).toBe(25);
    });
  });

  // ==========================================================================
  // Test Suite: Simple SQL Generation (no aggregation)
  // ==========================================================================

  describe("generateSimpleSQL", () => {
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
      baseTable = createDataTableInfo("users", fields, { dataFrameId: dataFrameId as UUID });
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
        const tableWithInternal = createDataTableInfo("users", fieldsWithInternal, {
          dataFrameId: dataFrameId as UUID,
        });
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

        // limit: 0 is falsy but should still be included
        expect(sql).not.toContain("LIMIT");
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

  // ==========================================================================
  // Test Suite: JOIN SQL Generation
  // ==========================================================================

  describe("generateJoinSQL", () => {
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

        expect(() => insight.toSQL()).toThrow("Join table empty_orders has no data");
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

  // ==========================================================================
  // Test Suite: Immutable Update Methods
  // ==========================================================================

  describe("immutable update methods", () => {
    let baseTable: DataTableInfo;
    let fields: DataTableField[];
    let insight: Insight;

    beforeEach(() => {
      fields = [
        createField("Name"),
        createField("Age", { type: "number" }),
        createField("City"),
      ];
      baseTable = createDataTableInfo("users", fields);
      insight = new Insight({
        name: "Original Insight",
        baseTable,
      });
    });

    describe("with", () => {
      it("should create a new Insight with updated properties", () => {
        const newInsight = insight.with({ name: "Updated Insight" });

        expect(newInsight).toBeInstanceOf(Insight);
        expect(newInsight.name).toBe("Updated Insight");
        expect(insight.name).toBe("Original Insight"); // Original unchanged
      });

      it("should preserve original ID when not updating ID", () => {
        const originalId = insight.id;
        const newInsight = insight.with({ name: "Updated Insight" });

        expect(newInsight.id).toBe(originalId);
      });

      it("should allow updating ID explicitly", () => {
        const newId = "new-custom-id" as UUID;
        const newInsight = insight.with({ id: newId });

        expect(newInsight.id).toBe(newId);
        expect(insight.id).not.toBe(newId); // Original unchanged
      });

      it("should preserve all other properties when updating one", () => {
        const insightWithConfig = new Insight({
          name: "Test",
          baseTable,
          selectedFields: [fields[0].id],
          limit: 50,
        });

        const newInsight = insightWithConfig.with({ name: "New Name" });

        expect(newInsight.selectedFields).toEqual([fields[0].id]);
        expect(newInsight.limit).toBe(50);
        expect(newInsight.baseTable).toBe(baseTable);
      });

      it("should allow multiple property updates at once", () => {
        const newInsight = insight.with({
          name: "New Name",
          limit: 100,
          groupBy: ["city"],
        });

        expect(newInsight.name).toBe("New Name");
        expect(newInsight.limit).toBe(100);
        expect(newInsight.groupBy).toEqual(["city"]);
      });

      it("should not modify the original insight", () => {
        const originalConfig = insight.config;
        insight.with({
          name: "Modified",
          limit: 999,
          groupBy: ["age"],
        });

        expect(insight.name).toBe("Original Insight");
        expect(insight.limit).toBeUndefined();
        expect(insight.groupBy).toEqual([]);
        expect(insight.config).toEqual(originalConfig);
      });
    });

    describe("withSelectedFields", () => {
      it("should create new Insight with updated selectedFields", () => {
        const newFieldIds = [fields[0].id, fields[1].id];
        const newInsight = insight.withSelectedFields(newFieldIds);

        expect(newInsight.selectedFields).toEqual(newFieldIds);
        expect(insight.selectedFields).toEqual([]); // Original unchanged
      });

      it("should replace existing selectedFields", () => {
        const insightWithFields = insight.withSelectedFields([fields[0].id]);
        const newerInsight = insightWithFields.withSelectedFields([fields[2].id]);

        expect(newerInsight.selectedFields).toEqual([fields[2].id]);
      });

      it("should allow empty array", () => {
        const insightWithFields = insight.withSelectedFields([fields[0].id]);
        const clearedInsight = insightWithFields.withSelectedFields([]);

        expect(clearedInsight.selectedFields).toEqual([]);
      });
    });

    describe("withMetrics", () => {
      it("should create new Insight with updated metrics", () => {
        const metrics = [
          {
            id: crypto.randomUUID() as UUID,
            name: "Count",
            sourceTable: baseTable.id,
            aggregation: "count",
          },
        ];
        const newInsight = insight.withMetrics(metrics);

        expect(newInsight.metrics).toEqual(metrics);
        expect(insight.metrics).toEqual([]); // Original unchanged
      });

      it("should replace existing metrics", () => {
        const metric1 = {
          id: crypto.randomUUID() as UUID,
          name: "Count",
          sourceTable: baseTable.id,
          aggregation: "count",
        };
        const metric2 = {
          id: crypto.randomUUID() as UUID,
          name: "Sum",
          sourceTable: baseTable.id,
          aggregation: "sum",
          columnName: "age",
        };

        const insightWithMetric = insight.withMetrics([metric1]);
        const newerInsight = insightWithMetric.withMetrics([metric2]);

        expect(newerInsight.metrics).toEqual([metric2]);
        expect(newerInsight.metrics).not.toContainEqual(metric1);
      });
    });

    describe("withFilters", () => {
      it("should create new Insight with updated filters", () => {
        const filters = [{ columnName: "age", operator: ">", value: 18 }];
        const newInsight = insight.withFilters(filters);

        expect(newInsight.filters).toEqual(filters);
        expect(insight.filters).toEqual([]); // Original unchanged
      });

      it("should replace existing filters", () => {
        const filter1 = { columnName: "age", operator: ">", value: 18 };
        const filter2 = { columnName: "city", operator: "=", value: "NYC" };

        const insightWithFilter = insight.withFilters([filter1]);
        const newerInsight = insightWithFilter.withFilters([filter2]);

        expect(newerInsight.filters).toEqual([filter2]);
      });

      it("should handle multiple filters", () => {
        const filters = [
          { columnName: "age", operator: ">", value: 18 },
          { columnName: "city", operator: "=", value: "NYC" },
          { columnName: "name", operator: "IS NOT NULL" },
        ];
        const newInsight = insight.withFilters(filters);

        expect(newInsight.filters).toHaveLength(3);
        expect(newInsight.filters).toEqual(filters);
      });
    });

    describe("withGroupBy", () => {
      it("should create new Insight with updated groupBy", () => {
        const groupBy = ["city", "age"];
        const newInsight = insight.withGroupBy(groupBy);

        expect(newInsight.groupBy).toEqual(groupBy);
        expect(insight.groupBy).toEqual([]); // Original unchanged
      });

      it("should replace existing groupBy", () => {
        const insightWithGroup = insight.withGroupBy(["city"]);
        const newerInsight = insightWithGroup.withGroupBy(["name"]);

        expect(newerInsight.groupBy).toEqual(["name"]);
      });
    });

    describe("withOrderBy", () => {
      it("should create new Insight with updated orderBy", () => {
        const orderBy = [{ columnName: "age", direction: "desc" as const }];
        const newInsight = insight.withOrderBy(orderBy);

        expect(newInsight.orderBy).toEqual(orderBy);
        expect(insight.orderBy).toEqual([]); // Original unchanged
      });

      it("should replace existing orderBy", () => {
        const order1 = [{ columnName: "age", direction: "asc" as const }];
        const order2 = [{ columnName: "name", direction: "desc" as const }];

        const insightWithOrder = insight.withOrderBy(order1);
        const newerInsight = insightWithOrder.withOrderBy(order2);

        expect(newerInsight.orderBy).toEqual(order2);
      });

      it("should handle multiple order columns", () => {
        const orderBy = [
          { columnName: "city", direction: "asc" as const },
          { columnName: "age", direction: "desc" as const },
        ];
        const newInsight = insight.withOrderBy(orderBy);

        expect(newInsight.orderBy).toHaveLength(2);
        expect(newInsight.orderBy).toEqual(orderBy);
      });
    });

    describe("withLimit", () => {
      it("should create new Insight with updated limit", () => {
        const newInsight = insight.withLimit(100);

        expect(newInsight.limit).toBe(100);
        expect(insight.limit).toBeUndefined(); // Original unchanged
      });

      it("should allow setting limit to undefined", () => {
        const insightWithLimit = insight.withLimit(50);
        const newerInsight = insightWithLimit.withLimit(undefined);

        expect(newerInsight.limit).toBeUndefined();
      });

      it("should replace existing limit", () => {
        const insightWithLimit = insight.withLimit(50);
        const newerInsight = insightWithLimit.withLimit(200);

        expect(newerInsight.limit).toBe(200);
      });
    });

    describe("withName", () => {
      it("should create new Insight with updated name", () => {
        const newInsight = insight.withName("Renamed Insight");

        expect(newInsight.name).toBe("Renamed Insight");
        expect(insight.name).toBe("Original Insight"); // Original unchanged
      });

      it("should preserve ID when renaming", () => {
        const originalId = insight.id;
        const newInsight = insight.withName("New Name");

        expect(newInsight.id).toBe(originalId);
      });
    });

    describe("immutability chain", () => {
      it("should support chaining multiple immutable updates", () => {
        const metric = {
          id: crypto.randomUUID() as UUID,
          name: "Total",
          sourceTable: baseTable.id,
          aggregation: "count",
        };

        const newInsight = insight
          .withName("Chained Insight")
          .withSelectedFields([fields[0].id])
          .withMetrics([metric])
          .withFilters([{ columnName: "age", operator: ">", value: 21 }])
          .withGroupBy(["city"])
          .withOrderBy([{ columnName: "city", direction: "asc" }])
          .withLimit(50);

        expect(newInsight.name).toBe("Chained Insight");
        expect(newInsight.selectedFields).toEqual([fields[0].id]);
        expect(newInsight.metrics).toEqual([metric]);
        expect(newInsight.filters).toEqual([{ columnName: "age", operator: ">", value: 21 }]);
        expect(newInsight.groupBy).toEqual(["city"]);
        expect(newInsight.orderBy).toEqual([{ columnName: "city", direction: "asc" }]);
        expect(newInsight.limit).toBe(50);

        // Original should be unchanged
        expect(insight.name).toBe("Original Insight");
        expect(insight.selectedFields).toEqual([]);
        expect(insight.metrics).toEqual([]);
      });
    });
  });

  // ==========================================================================
  // Test Suite: Utility Methods
  // ==========================================================================

  describe("utility methods", () => {
    let baseTable: DataTableInfo;
    let fields: DataTableField[];

    beforeEach(() => {
      fields = [
        createField("Name"),
        createField("Age", { type: "number" }),
        createField("City"),
      ];
      baseTable = createDataTableInfo("users", fields);
    });

    describe("toJSON", () => {
      it("should return a copy of the configuration", () => {
        const insight = new Insight({
          name: "Test Insight",
          baseTable,
          selectedFields: [fields[0].id],
          limit: 100,
        });

        const json = insight.toJSON();

        expect(json.name).toBe("Test Insight");
        expect(json.baseTable).toBe(baseTable);
        expect(json.selectedFields).toEqual([fields[0].id]);
        expect(json.limit).toBe(100);
      });

      it("should return a new object each time", () => {
        const insight = new Insight({
          name: "Test Insight",
          baseTable,
        });

        const json1 = insight.toJSON();
        const json2 = insight.toJSON();

        expect(json1).not.toBe(json2);
        expect(json1).toEqual(json2);
      });

      it("should include all configuration properties", () => {
        const metric = {
          id: crypto.randomUUID() as UUID,
          name: "Count",
          sourceTable: baseTable.id,
          aggregation: "count",
        };
        const insight = new Insight({
          name: "Full Insight",
          baseTable,
          selectedFields: [fields[0].id, fields[1].id],
          metrics: [metric],
          filters: [{ columnName: "age", operator: ">", value: 18 }],
          groupBy: ["city"],
          orderBy: [{ columnName: "age", direction: "desc" }],
          limit: 50,
        });

        const json = insight.toJSON();

        expect(json.id).toBeDefined();
        expect(json.name).toBe("Full Insight");
        expect(json.baseTable).toBe(baseTable);
        expect(json.selectedFields).toEqual([fields[0].id, fields[1].id]);
        expect(json.metrics).toEqual([metric]);
        expect(json.filters).toEqual([{ columnName: "age", operator: ">", value: 18 }]);
        expect(json.groupBy).toEqual(["city"]);
        expect(json.orderBy).toEqual([{ columnName: "age", direction: "desc" }]);
        expect(json.limit).toBe(50);
      });
    });

    describe("fromJSON", () => {
      it("should create an Insight from configuration object", () => {
        const config = {
          name: "From JSON Insight",
          baseTable,
        };

        const insight = Insight.fromJSON(config);

        expect(insight).toBeInstanceOf(Insight);
        expect(insight.name).toBe("From JSON Insight");
        expect(insight.baseTable).toBe(baseTable);
      });

      it("should preserve ID from config", () => {
        const customId = "preserved-id-123" as UUID;
        const config = {
          id: customId,
          name: "With ID",
          baseTable,
        };

        const insight = Insight.fromJSON(config);

        expect(insight.id).toBe(customId);
      });

      it("should round-trip correctly with toJSON", () => {
        const original = new Insight({
          name: "Round Trip",
          baseTable,
          selectedFields: [fields[0].id],
          metrics: [{
            id: crypto.randomUUID() as UUID,
            name: "Count",
            sourceTable: baseTable.id,
            aggregation: "count",
          }],
          filters: [{ columnName: "age", operator: ">", value: 21 }],
          groupBy: ["city"],
          orderBy: [{ columnName: "name", direction: "asc" }],
          limit: 100,
        });

        const json = original.toJSON();
        const restored = Insight.fromJSON(json);

        expect(restored.id).toBe(original.id);
        expect(restored.name).toBe(original.name);
        expect(restored.baseTable).toBe(original.baseTable);
        expect(restored.selectedFields).toEqual(original.selectedFields);
        expect(restored.metrics).toEqual(original.metrics);
        expect(restored.filters).toEqual(original.filters);
        expect(restored.groupBy).toEqual(original.groupBy);
        expect(restored.orderBy).toEqual(original.orderBy);
        expect(restored.limit).toBe(original.limit);
      });

      it("should throw error for invalid config", () => {
        expect(() => Insight.fromJSON({ name: "", baseTable })).toThrow(
          "Insight must have a name",
        );
        // @ts-expect-error - Testing runtime validation
        expect(() => Insight.fromJSON({ name: "Test" })).toThrow(
          "Insight must have a baseTable",
        );
      });
    });

    describe("hasAnalytics", () => {
      it("should return false for empty insight", () => {
        const insight = new Insight({
          name: "Empty Insight",
          baseTable,
        });

        expect(insight.hasAnalytics()).toBe(false);
      });

      it("should return true when metrics are present", () => {
        const insight = new Insight({
          name: "With Metrics",
          baseTable,
          metrics: [{
            id: crypto.randomUUID() as UUID,
            name: "Count",
            sourceTable: baseTable.id,
            aggregation: "count",
          }],
        });

        expect(insight.hasAnalytics()).toBe(true);
      });

      it("should return true when groupBy is present", () => {
        const insight = new Insight({
          name: "With GroupBy",
          baseTable,
          groupBy: ["city"],
        });

        expect(insight.hasAnalytics()).toBe(true);
      });

      it("should return true when filters are present", () => {
        const insight = new Insight({
          name: "With Filters",
          baseTable,
          filters: [{ columnName: "age", operator: ">", value: 18 }],
        });

        expect(insight.hasAnalytics()).toBe(true);
      });

      it("should return true when multiple analytics features are present", () => {
        const insight = new Insight({
          name: "Full Analytics",
          baseTable,
          metrics: [{
            id: crypto.randomUUID() as UUID,
            name: "Count",
            sourceTable: baseTable.id,
            aggregation: "count",
          }],
          groupBy: ["city"],
          filters: [{ columnName: "age", operator: ">", value: 18 }],
        });

        expect(insight.hasAnalytics()).toBe(true);
      });

      it("should return false with only selectedFields", () => {
        const insight = new Insight({
          name: "Only Fields",
          baseTable,
          selectedFields: [fields[0].id],
        });

        expect(insight.hasAnalytics()).toBe(false);
      });

      it("should return false with only orderBy and limit", () => {
        const insight = new Insight({
          name: "Only Ordering",
          baseTable,
          orderBy: [{ columnName: "name", direction: "asc" }],
          limit: 100,
        });

        expect(insight.hasAnalytics()).toBe(false);
      });
    });

    describe("isReady", () => {
      it("should return false for empty insight", () => {
        const insight = new Insight({
          name: "Empty Insight",
          baseTable,
        });

        expect(insight.isReady()).toBe(false);
      });

      it("should return true when selectedFields are present", () => {
        const insight = new Insight({
          name: "With Fields",
          baseTable,
          selectedFields: [fields[0].id],
        });

        expect(insight.isReady()).toBe(true);
      });

      it("should return true when hasAnalytics is true", () => {
        const insight = new Insight({
          name: "With Filters",
          baseTable,
          filters: [{ columnName: "age", operator: ">", value: 18 }],
        });

        expect(insight.isReady()).toBe(true);
      });

      it("should return true with metrics only", () => {
        const insight = new Insight({
          name: "With Metrics",
          baseTable,
          metrics: [{
            id: crypto.randomUUID() as UUID,
            name: "Count",
            sourceTable: baseTable.id,
            aggregation: "count",
          }],
        });

        expect(insight.isReady()).toBe(true);
      });

      it("should return true with groupBy only", () => {
        const insight = new Insight({
          name: "With GroupBy",
          baseTable,
          groupBy: ["city"],
        });

        expect(insight.isReady()).toBe(true);
      });

      it("should return false with only orderBy", () => {
        const insight = new Insight({
          name: "Only Order",
          baseTable,
          orderBy: [{ columnName: "name", direction: "asc" }],
        });

        expect(insight.isReady()).toBe(false);
      });

      it("should return false with only limit", () => {
        const insight = new Insight({
          name: "Only Limit",
          baseTable,
          limit: 100,
        });

        expect(insight.isReady()).toBe(false);
      });
    });

    describe("getDescription", () => {
      it("should return default description for empty insight", () => {
        const insight = new Insight({
          name: "Empty Insight",
          baseTable,
        });

        expect(insight.getDescription()).toBe("show all data");
      });

      it("should describe selectedFields count", () => {
        const insight = new Insight({
          name: "With Fields",
          baseTable,
          selectedFields: [fields[0].id, fields[1].id],
        });

        const description = insight.getDescription();

        expect(description).toContain("show 2 fields");
      });

      it("should describe groupBy columns", () => {
        const insight = new Insight({
          name: "With GroupBy",
          baseTable,
          groupBy: ["city", "age"],
        });

        const description = insight.getDescription();

        expect(description).toContain("grouped by city, age");
      });

      it("should describe metrics by name", () => {
        const insight = new Insight({
          name: "With Metrics",
          baseTable,
          metrics: [
            {
              id: crypto.randomUUID() as UUID,
              name: "Total Count",
              sourceTable: baseTable.id,
              aggregation: "count",
            },
            {
              id: crypto.randomUUID() as UUID,
              name: "Average Age",
              sourceTable: baseTable.id,
              aggregation: "avg",
              columnName: "age",
            },
          ],
        });

        const description = insight.getDescription();

        expect(description).toContain("with metrics: Total Count, Average Age");
      });

      it("should describe filter count", () => {
        const insight = new Insight({
          name: "With Filters",
          baseTable,
          filters: [
            { columnName: "age", operator: ">", value: 18 },
            { columnName: "city", operator: "=", value: "NYC" },
            { columnName: "name", operator: "IS NOT NULL" },
          ],
        });

        const description = insight.getDescription();

        expect(description).toContain("filtered by 3 conditions");
      });

      it("should describe limit", () => {
        const insight = new Insight({
          name: "With Limit",
          baseTable,
          limit: 100,
        });

        const description = insight.getDescription();

        expect(description).toContain("limited to 100 rows");
      });

      it("should combine multiple description parts", () => {
        const insight = new Insight({
          name: "Full Insight",
          baseTable,
          selectedFields: [fields[0].id],
          groupBy: ["city"],
          metrics: [{
            id: crypto.randomUUID() as UUID,
            name: "Count",
            sourceTable: baseTable.id,
            aggregation: "count",
          }],
          filters: [{ columnName: "age", operator: ">", value: 18 }],
          limit: 50,
        });

        const description = insight.getDescription();

        expect(description).toContain("show 1 fields");
        expect(description).toContain("grouped by city");
        expect(description).toContain("with metrics: Count");
        expect(description).toContain("filtered by 1 conditions");
        expect(description).toContain("limited to 50 rows");
      });

      it("should not include limit of 0 in description", () => {
        const insight = new Insight({
          name: "Zero Limit",
          baseTable,
          limit: 0,
        });

        const description = insight.getDescription();

        expect(description).not.toContain("limited");
        expect(description).toBe("show all data");
      });
    });
  });
});
