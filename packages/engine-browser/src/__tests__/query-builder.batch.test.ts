/**
 * Unit tests for QueryBuilder - Static batchQuery Method
 *
 * Tests cover:
 * - Empty query array
 * - Single query execution
 * - Multiple query execution with UNION ALL
 * - Result partitioning by _batch_idx
 * - Error handling
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryBuilder } from "../query-builder";
import {
  createMockConnection,
  createMockConnectionWithArrayResults,
  createMockConnectionWithError,
} from "./query-builder.fixtures";

describe("QueryBuilder - Static batchQuery()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("empty array", () => {
    it("should return empty array when given empty queries array", async () => {
      const conn = createMockConnection();

      const results = await QueryBuilder.batchQuery(conn, []);

      expect(results).toEqual([]);
      expect(results).toHaveLength(0);
    });

    it("should not call conn.query when given empty queries array", async () => {
      const conn = createMockConnection();
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;

      await QueryBuilder.batchQuery(conn, []);

      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("single query", () => {
    it("should execute single query and return results wrapped in array", async () => {
      const mockResults = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ];
      const conn = createMockConnectionWithArrayResults(mockResults);

      const results = await QueryBuilder.batchQuery(conn, [
        "SELECT * FROM users",
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(mockResults);
    });

    it("should execute the query directly without UNION ALL wrapping", async () => {
      const conn = createMockConnectionWithArrayResults([]);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;

      await QueryBuilder.batchQuery(conn, ["SELECT COUNT(*) FROM users"]);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith("SELECT COUNT(*) FROM users");
    });

    it("should return empty array result for single query with no rows", async () => {
      const conn = createMockConnectionWithArrayResults([]);

      const results = await QueryBuilder.batchQuery(conn, [
        "SELECT * FROM empty_table",
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual([]);
    });
  });

  describe("multiple queries", () => {
    it("should combine queries with UNION ALL and _batch_idx", async () => {
      const mockCombinedResults = [
        { _batch_idx: 0, count: 10 },
        { _batch_idx: 1, value: "sample" },
      ];
      const conn = createMockConnectionWithArrayResults(mockCombinedResults);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;

      await QueryBuilder.batchQuery(conn, [
        "SELECT COUNT(*) as count FROM table1",
        "SELECT value FROM table2 LIMIT 1",
      ]);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArg = mockQuery.mock.calls[0][0];
      expect(callArg).toContain("SELECT 0 as _batch_idx, *");
      expect(callArg).toContain("SELECT 1 as _batch_idx, *");
      expect(callArg).toContain("UNION ALL");
    });

    it("should partition results by _batch_idx correctly", async () => {
      const mockCombinedResults = [
        { _batch_idx: 0, id: 1, name: "Alice" },
        { _batch_idx: 0, id: 2, name: "Bob" },
        { _batch_idx: 1, category: "A", total: 100 },
        { _batch_idx: 1, category: "B", total: 200 },
        { _batch_idx: 1, category: "C", total: 300 },
      ];
      const conn = createMockConnectionWithArrayResults(mockCombinedResults);

      const results = await QueryBuilder.batchQuery(conn, [
        "SELECT id, name FROM users",
        "SELECT category, total FROM sales",
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]).toHaveLength(2);
      expect(results[1]).toHaveLength(3);
      expect(results[0]).toEqual([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ]);
      expect(results[1]).toEqual([
        { category: "A", total: 100 },
        { category: "B", total: 200 },
        { category: "C", total: 300 },
      ]);
    });

    it("should strip _batch_idx from returned results", async () => {
      const mockCombinedResults = [
        { _batch_idx: 0, value: 42 },
        { _batch_idx: 1, name: "test" },
      ];
      const conn = createMockConnectionWithArrayResults(mockCombinedResults);

      const results = await QueryBuilder.batchQuery(conn, [
        "SELECT value FROM t1",
        "SELECT name FROM t2",
      ]);

      // Verify _batch_idx is not in the results
      expect(results[0][0]).not.toHaveProperty("_batch_idx");
      expect(results[1][0]).not.toHaveProperty("_batch_idx");
      expect(results[0][0]).toEqual({ value: 42 });
      expect(results[1][0]).toEqual({ name: "test" });
    });

    it("should handle three or more queries", async () => {
      const mockCombinedResults = [
        { _batch_idx: 0, a: 1 },
        { _batch_idx: 1, b: 2 },
        { _batch_idx: 2, c: 3 },
      ];
      const conn = createMockConnectionWithArrayResults(mockCombinedResults);

      const results = await QueryBuilder.batchQuery(conn, [
        "SELECT a FROM t1",
        "SELECT b FROM t2",
        "SELECT c FROM t3",
      ]);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual([{ a: 1 }]);
      expect(results[1]).toEqual([{ b: 2 }]);
      expect(results[2]).toEqual([{ c: 3 }]);
    });

    it("should handle query with empty results", async () => {
      const mockCombinedResults = [
        { _batch_idx: 0, value: "exists" },
        // No results for query 1
      ];
      const conn = createMockConnectionWithArrayResults(mockCombinedResults);

      const results = await QueryBuilder.batchQuery(conn, [
        "SELECT value FROM existing",
        "SELECT value FROM empty",
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual([{ value: "exists" }]);
      expect(results[1]).toEqual([]); // Empty array for query with no results
    });

    it("should handle all queries returning empty results", async () => {
      const conn = createMockConnectionWithArrayResults([]);

      const results = await QueryBuilder.batchQuery(conn, [
        "SELECT * FROM empty1",
        "SELECT * FROM empty2",
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual([]);
      expect(results[1]).toEqual([]);
    });

    it("should maintain order of results matching query order", async () => {
      // Results come back in arbitrary order from UNION ALL
      const mockCombinedResults = [
        { _batch_idx: 2, order: "third" },
        { _batch_idx: 0, order: "first" },
        { _batch_idx: 1, order: "second" },
      ];
      const conn = createMockConnectionWithArrayResults(mockCombinedResults);

      const results = await QueryBuilder.batchQuery(conn, [
        "SELECT 'first' as order",
        "SELECT 'second' as order",
        "SELECT 'third' as order",
      ]);

      expect(results).toHaveLength(3);
      expect(results[0][0].order).toBe("first");
      expect(results[1][0].order).toBe("second");
      expect(results[2][0].order).toBe("third");
    });
  });

  describe("error handling", () => {
    it("should propagate query errors", async () => {
      const conn = createMockConnectionWithError(
        new Error("Batch query failed"),
      );

      await expect(
        QueryBuilder.batchQuery(conn, ["SELECT * FROM users"]),
      ).rejects.toThrow("Batch query failed");
    });

    it("should propagate errors for multiple queries", async () => {
      const conn = createMockConnectionWithError(new Error("UNION ALL failed"));

      await expect(
        QueryBuilder.batchQuery(conn, ["SELECT * FROM t1", "SELECT * FROM t2"]),
      ).rejects.toThrow("UNION ALL failed");
    });
  });
});
