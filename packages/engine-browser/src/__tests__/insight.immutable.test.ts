/**
 * Unit tests for Insight class - Immutable Update Methods
 *
 * Tests cover:
 * - with() method for generic updates
 * - withSelectedFields() method
 * - withMetrics() method
 * - withFilters() method
 * - withGroupBy() method
 * - withOrderBy() method
 * - withLimit() method
 * - withName() method
 * - Immutability chain testing
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

describe("Insight - Immutable Update Methods", () => {
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
      const metrics: InsightMetric[] = [
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
      const metric1: InsightMetric = {
        id: crypto.randomUUID() as UUID,
        name: "Count",
        sourceTable: baseTable.id,
        aggregation: "count",
      };
      const metric2: InsightMetric = {
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
      const metric: InsightMetric = {
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
      expect(newInsight.filters).toEqual([
        { columnName: "age", operator: ">", value: 21 },
      ]);
      expect(newInsight.groupBy).toEqual(["city"]);
      expect(newInsight.orderBy).toEqual([
        { columnName: "city", direction: "asc" },
      ]);
      expect(newInsight.limit).toBe(50);

      // Original should be unchanged
      expect(insight.name).toBe("Original Insight");
      expect(insight.selectedFields).toEqual([]);
      expect(insight.metrics).toEqual([]);
    });
  });
});
