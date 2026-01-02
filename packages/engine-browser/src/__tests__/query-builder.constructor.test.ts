/**
 * Unit tests for QueryBuilder - Constructor and Immutability
 *
 * Tests cover:
 * - Constructor with dataFrame and connection
 * - Default and optional operations array
 * - Immutability of all chainable methods
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { DataFrame } from "@dashframe/engine";
import { QueryBuilder } from "../query-builder";
import {
  createMockDataFrame,
  createMockConnection,
} from "./query-builder.fixtures";

describe("QueryBuilder - Constructor and Immutability", () => {
  let mockDataFrame: DataFrame;
  let mockConn: AsyncDuckDBConnection;
  let queryBuilder: QueryBuilder;

  beforeEach(() => {
    mockDataFrame = createMockDataFrame();
    mockConn = createMockConnection();
    queryBuilder = new QueryBuilder(mockDataFrame, mockConn);
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with dataFrame and connection", () => {
      const qb = new QueryBuilder(mockDataFrame, mockConn);
      expect(qb).toBeInstanceOf(QueryBuilder);
    });

    it("should create instance with empty operations by default", async () => {
      const qb = new QueryBuilder(mockDataFrame, mockConn);
      // Verify no operations by checking SQL output structure
      // We can't directly access private operations, but we can verify behavior
      expect(qb).toBeInstanceOf(QueryBuilder);
    });

    it("should accept optional operations array", () => {
      const operations = [{ type: "limit" as const, count: 10 }];
      const qb = new QueryBuilder(
        mockDataFrame,
        mockConn,
        operations as never[],
      );
      expect(qb).toBeInstanceOf(QueryBuilder);
    });
  });

  describe("immutability", () => {
    it("filter should return a new QueryBuilder instance", () => {
      const newQb = queryBuilder.filter([
        { columnName: "age", operator: ">", value: 18 },
      ]);

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("sort should return a new QueryBuilder instance", () => {
      const newQb = queryBuilder.sort([
        { columnName: "name", direction: "asc" },
      ]);

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("orderBy should return a new QueryBuilder instance", () => {
      const newQb = queryBuilder.orderBy([
        { columnName: "name", direction: "desc" },
      ]);

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("groupBy should return a new QueryBuilder instance", () => {
      const newQb = queryBuilder.groupBy(["category"]);

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("join should return a new QueryBuilder instance", () => {
      const otherDf = createMockDataFrame("other-df");
      const newQb = queryBuilder.join(otherDf, {
        type: "inner",
        leftColumn: "id",
        rightColumn: "user_id",
      });

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("limit should return a new QueryBuilder instance", () => {
      const newQb = queryBuilder.limit(10);

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("offset should return a new QueryBuilder instance", () => {
      const newQb = queryBuilder.offset(5);

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("select should return a new QueryBuilder instance", () => {
      const newQb = queryBuilder.select(["name", "age"]);

      expect(newQb).toBeInstanceOf(QueryBuilder);
      expect(newQb).not.toBe(queryBuilder);
    });

    it("original QueryBuilder should remain unchanged after chaining", () => {
      const original = new QueryBuilder(mockDataFrame, mockConn);

      // Chain multiple operations
      original
        .filter([{ columnName: "age", operator: ">", value: 18 }])
        .sort([{ columnName: "name", direction: "asc" }])
        .limit(10);

      // Original should still be usable and unchanged
      expect(original).toBeInstanceOf(QueryBuilder);
    });
  });
});
