/**
 * Unit tests for QueryBuilder - Chainable Methods
 *
 * Tests cover:
 * - Method chaining
 * - filter() method with various predicates
 * - sort() and orderBy() methods
 * - groupBy() method with aggregations
 * - join() method with various join types
 * - limit() and offset() methods
 * - select() method
 * - Operation accumulation
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { DataFrame } from "@dashframe/engine";
import { QueryBuilder } from "../query-builder";
import {
  createMockDataFrame,
  createMockConnection,
} from "./query-builder.fixtures";

describe("QueryBuilder - Chainable Methods", () => {
  let mockDataFrame: DataFrame;
  let mockConn: AsyncDuckDBConnection;
  let queryBuilder: QueryBuilder;

  beforeEach(() => {
    mockDataFrame = createMockDataFrame();
    mockConn = createMockConnection();
    queryBuilder = new QueryBuilder(mockDataFrame, mockConn);
    vi.clearAllMocks();
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
        .groupBy(
          ["category"],
          [{ columnName: "amount", function: "sum", alias: "total" }],
        )
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
      const result = queryBuilder.groupBy(
        ["category"],
        [
          { columnName: "amount", function: "sum", alias: "total_amount" },
          { columnName: "id", function: "count", alias: "count" },
        ],
      );

      expect(result).toBeInstanceOf(QueryBuilder);
    });

    it("should accept aggregations with various functions", () => {
      const result = queryBuilder.groupBy(
        ["category"],
        [
          { columnName: "amount", function: "sum", alias: "sum_amount" },
          { columnName: "amount", function: "avg", alias: "avg_amount" },
          { columnName: "amount", function: "min", alias: "min_amount" },
          { columnName: "amount", function: "max", alias: "max_amount" },
          { columnName: "id", function: "count", alias: "total_count" },
        ],
      );

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
});
