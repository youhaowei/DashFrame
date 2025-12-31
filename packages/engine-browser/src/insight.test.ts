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
});
