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
});
