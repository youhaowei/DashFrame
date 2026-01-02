/**
 * Unit tests for Insight class - Utility Methods
 *
 * Tests cover:
 * - toJSON() method
 * - fromJSON() static method
 * - hasAnalytics() method
 * - isReady() method
 * - getDescription() method
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Insight } from "../insight";
import type {
  DataTableInfo,
  DataTableField,
  UUID,
  InsightMetric,
} from "@dashframe/engine";
import { createField, createDataTableInfo } from "./insight.fixtures";

describe("Insight - Utility Methods", () => {
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
      const metric: InsightMetric = {
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
      expect(json.filters).toEqual([
        { columnName: "age", operator: ">", value: 18 },
      ]);
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
        metrics: [
          {
            id: crypto.randomUUID() as UUID,
            name: "Count",
            sourceTable: baseTable.id,
            aggregation: "count",
          },
        ],
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
        metrics: [
          {
            id: crypto.randomUUID() as UUID,
            name: "Count",
            sourceTable: baseTable.id,
            aggregation: "count",
          },
        ],
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
        metrics: [
          {
            id: crypto.randomUUID() as UUID,
            name: "Count",
            sourceTable: baseTable.id,
            aggregation: "count",
          },
        ],
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
        metrics: [
          {
            id: crypto.randomUUID() as UUID,
            name: "Count",
            sourceTable: baseTable.id,
            aggregation: "count",
          },
        ],
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
        metrics: [
          {
            id: crypto.randomUUID() as UUID,
            name: "Count",
            sourceTable: baseTable.id,
            aggregation: "count",
          },
        ],
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
