/**
 * Unit tests for QueryBuilder - Execution Methods
 *
 * Tests cover:
 * - rows() method
 * - count() method
 * - preview() method
 * - run() method
 * - Error handling for execution methods
 */
import type { DataFrame } from "@dashframe/engine";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryBuilder } from "../query-builder";
import {
  createMockConnectionForRun,
  createMockConnectionWithResults,
  createMockDataFrame,
  createMockUserResults,
  createTestQueryBuilder,
} from "./query-builder.fixtures";

// Mock BrowserDataFrame for run() tests - must be in test file for Vitest hoisting
vi.mock("../dataframe", () => ({
  BrowserDataFrame: {
    create: vi.fn().mockResolvedValue({
      id: "mock-result-df-id",
      storage: { type: "indexeddb", key: "arrow-mock-result-df-id" },
      fieldIds: [],
      createdAt: Date.now(),
    }),
  },
}));

describe("QueryBuilder - Execution Methods", () => {
  let mockDataFrame: DataFrame;

  beforeEach(() => {
    mockDataFrame = createMockDataFrame();
    vi.clearAllMocks();
  });

  describe("rows()", () => {
    it("should execute query and return results as array of records", async () => {
      const mockResults = [
        { id: 1, name: "Alice", age: 30 },
        { id: 2, name: "Bob", age: 25 },
        { id: 3, name: "Charlie", age: 35 },
      ];
      const conn = createMockConnectionWithResults(mockResults);
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      const results = await qb.rows();

      expect(results).toEqual(mockResults);
      expect(results).toHaveLength(3);
    });

    it("should return empty array when no rows match", async () => {
      const conn = createMockConnectionWithResults([]);
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      const results = await qb.rows();

      expect(results).toEqual([]);
      expect(results).toHaveLength(0);
    });

    it("should execute the generated SQL query", async () => {
      const mockResults = [{ id: 1, name: "Test" }];
      const conn = createMockConnectionWithResults(mockResults);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      await qb.rows();

      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM "df_test_df_id"');
    });

    it("should execute query with filter operations", async () => {
      const mockResults = [{ id: 1, name: "Alice", active: true }];
      const conn = createMockConnectionWithResults(mockResults);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;
      const qb = createTestQueryBuilder(mockDataFrame, conn).filter([
        { columnName: "active", operator: "=", value: true },
      ]);

      await qb.rows();

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM "df_test_df_id" WHERE "active" = TRUE',
      );
    });

    it("should execute query with all chained operations", async () => {
      const mockResults = [{ name: "Alice" }];
      const conn = createMockConnectionWithResults(mockResults);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;
      const qb = createTestQueryBuilder(mockDataFrame, conn)
        .select(["name", "age"])
        .filter([{ columnName: "age", operator: ">", value: 21 }])
        .sort([{ columnName: "name", direction: "asc" }])
        .limit(10);

      await qb.rows();

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT "name", "age" FROM "df_test_df_id" WHERE "age" > 21 ORDER BY "name" ASC LIMIT 10',
      );
    });

    it("should return results with correct data types", async () => {
      const mockResults = [
        {
          id: 1,
          name: "Alice",
          balance: 1234.56,
          active: true,
          created_at: "2024-01-15",
          metadata: null,
        },
      ];
      const conn = createMockConnectionWithResults(mockResults);
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      const results = await qb.rows();

      expect(results[0].id).toBe(1);
      expect(results[0].name).toBe("Alice");
      expect(results[0].balance).toBe(1234.56);
      expect(results[0].active).toBe(true);
      expect(results[0].metadata).toBe(null);
    });
  });

  describe("count()", () => {
    it("should return the count of matching rows", async () => {
      const mockCountResult = [{ count: 42 }];
      const conn = createMockConnectionWithResults(mockCountResult);
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      const count = await qb.count();

      expect(count).toBe(42);
    });

    it("should return 0 when no rows match", async () => {
      const mockCountResult = [{ count: 0 }];
      const conn = createMockConnectionWithResults(mockCountResult);
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      const count = await qb.count();

      expect(count).toBe(0);
    });

    it("should return 0 when result is undefined", async () => {
      const conn = createMockConnectionWithResults([]);
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      const count = await qb.count();

      expect(count).toBe(0);
    });

    it("should wrap query in COUNT(*) subquery", async () => {
      const mockCountResult = [{ count: 100 }];
      const conn = createMockConnectionWithResults(mockCountResult);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      await qb.count();

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT COUNT(*) as count FROM (SELECT * FROM "df_test_df_id")',
      );
    });

    it("should exclude limit and offset from count query", async () => {
      const mockCountResult = [{ count: 1000 }];
      const conn = createMockConnectionWithResults(mockCountResult);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;
      const qb = createTestQueryBuilder(mockDataFrame, conn)
        .filter([{ columnName: "active", operator: "=", value: true }])
        .limit(10)
        .offset(20);

      await qb.count();

      // Count should not include LIMIT or OFFSET
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT COUNT(*) as count FROM (SELECT * FROM "df_test_df_id" WHERE "active" = TRUE)',
      );
    });

    it("should exclude sort and select from count query", async () => {
      const mockCountResult = [{ count: 50 }];
      const conn = createMockConnectionWithResults(mockCountResult);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;
      const qb = createTestQueryBuilder(mockDataFrame, conn)
        .select(["name", "age"])
        .filter([{ columnName: "status", operator: "=", value: "active" }])
        .sort([{ columnName: "name", direction: "asc" }]);

      await qb.count();

      // Count should not include SELECT columns or ORDER BY
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT COUNT(*) as count FROM (SELECT * FROM "df_test_df_id" WHERE "status" = \'active\')',
      );
    });

    it("should preserve filter and join operations in count query", async () => {
      const mockCountResult = [{ count: 25 }];
      const conn = createMockConnectionWithResults(mockCountResult);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;
      const qb = createTestQueryBuilder(mockDataFrame, conn)
        .filter([{ columnName: "age", operator: ">", value: 18 }])
        .filter([{ columnName: "country", operator: "=", value: "US" }]);

      await qb.count();

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT COUNT(*) as count FROM (SELECT * FROM "df_test_df_id" WHERE "age" > 18 AND "country" = \'US\')',
      );
    });

    it("should handle large counts", async () => {
      const mockCountResult = [{ count: 9007199254740991 }]; // Max safe integer
      const conn = createMockConnectionWithResults(mockCountResult);
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      const count = await qb.count();

      expect(count).toBe(9007199254740991);
    });

    it("should convert string count to number", async () => {
      // Some database drivers might return count as string
      const mockCountResult = [{ count: "123" }];
      const conn = createMockConnectionWithResults(mockCountResult);
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      const count = await qb.count();

      expect(count).toBe(123);
      expect(typeof count).toBe("number");
    });
  });

  describe("preview()", () => {
    it("should return first 10 rows by default", async () => {
      const mockResults = createMockUserResults(10);
      const conn = createMockConnectionWithResults(mockResults);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      const results = await qb.preview();

      expect(results).toHaveLength(10);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM "df_test_df_id" LIMIT 10',
      );
    });

    it("should accept custom limit parameter", async () => {
      const mockResults = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Charlie" },
        { id: 4, name: "David" },
        { id: 5, name: "Eve" },
      ];
      const conn = createMockConnectionWithResults(mockResults);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      const results = await qb.preview(5);

      expect(results).toHaveLength(5);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM "df_test_df_id" LIMIT 5',
      );
    });

    it("should preserve other operations when adding limit", async () => {
      const mockResults = [{ name: "Alice", age: 25 }];
      const conn = createMockConnectionWithResults(mockResults);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;
      const qb = createTestQueryBuilder(mockDataFrame, conn)
        .select(["name", "age"])
        .filter([{ columnName: "active", operator: "=", value: true }])
        .sort([{ columnName: "name", direction: "asc" }]);

      await qb.preview(5);

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT "name", "age" FROM "df_test_df_id" WHERE "active" = TRUE ORDER BY "name" ASC LIMIT 5',
      );
    });

    it("should override existing limit", async () => {
      const mockResults = [{ id: 1 }];
      const conn = createMockConnectionWithResults(mockResults);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;
      const qb = createTestQueryBuilder(mockDataFrame, conn).limit(100);

      await qb.preview(3);

      // preview(3) should override the previous limit(100)
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM "df_test_df_id" LIMIT 3',
      );
    });

    it("should return empty array when no data", async () => {
      const conn = createMockConnectionWithResults([]);
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      const results = await qb.preview();

      expect(results).toEqual([]);
    });

    it("should work with limit of 1", async () => {
      const mockResults = [{ id: 1, name: "First" }];
      const conn = createMockConnectionWithResults(mockResults);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      const results = await qb.preview(1);

      expect(results).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM "df_test_df_id" LIMIT 1',
      );
    });
  });

  describe("run()", () => {
    it("should execute query and return a BrowserDataFrame", async () => {
      const mockArrowBuffer = new Uint8Array([1, 2, 3, 4]);
      const conn = createMockConnectionForRun(mockArrowBuffer);
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      const result = await qb.run();

      expect(result).toBeDefined();
      expect(result.id).toBe("mock-result-df-id");
    });

    it("should use COPY TO with ARROW format", async () => {
      const mockArrowBuffer = new Uint8Array([1, 2, 3, 4]);
      const conn = createMockConnectionForRun(mockArrowBuffer);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      await qb.run();

      // Verify COPY TO ARROW format is used
      const callArg = mockQuery.mock.calls[0][0];
      expect(callArg).toContain("COPY");
      expect(callArg).toContain("FORMAT ARROW");
      expect(callArg).toContain("output.arrow");
    });

    it("should include all operations in the exported query", async () => {
      const mockArrowBuffer = new Uint8Array([1, 2, 3, 4]);
      const conn = createMockConnectionForRun(mockArrowBuffer);
      const mockQuery = conn.query as ReturnType<typeof vi.fn>;
      const qb = createTestQueryBuilder(mockDataFrame, conn)
        .select(["name", "age"])
        .filter([{ columnName: "active", operator: "=", value: true }])
        .limit(50);

      await qb.run();

      const callArg = mockQuery.mock.calls[0][0];
      expect(callArg).toContain('"name"');
      expect(callArg).toContain('"age"');
      expect(callArg).toContain('"active" = TRUE');
      expect(callArg).toContain("LIMIT 50");
    });

    it("should call BrowserDataFrame.create with arrow buffer", async () => {
      const mockArrowBuffer = new Uint8Array([1, 2, 3, 4]);
      const conn = createMockConnectionForRun(mockArrowBuffer);
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      // Import the mocked module to verify calls
      const { BrowserDataFrame } = await import("../dataframe");

      await qb.run();

      expect(BrowserDataFrame.create).toHaveBeenCalledWith(mockArrowBuffer, []);
    });

    it("should preserve immutability - original builder unchanged", async () => {
      const mockArrowBuffer = new Uint8Array([1, 2, 3, 4]);
      const conn = createMockConnectionForRun(mockArrowBuffer);
      const original = createTestQueryBuilder(mockDataFrame, conn);

      // Create a modified builder and run
      const modified = original
        .filter([{ columnName: "active", operator: "=", value: true }])
        .limit(10);
      await modified.run();

      // Original should still be usable
      expect(original).toBeInstanceOf(QueryBuilder);
      const originalSql = await original.sql();
      expect(originalSql).toBe('SELECT * FROM "df_test_df_id"');
    });
  });

  describe("execution method error handling", () => {
    it("rows() should propagate query errors", async () => {
      const conn = {
        query: vi.fn().mockRejectedValue(new Error("Query execution failed")),
        insertArrowFromIPCStream: vi.fn().mockResolvedValue(undefined),
      } as unknown as AsyncDuckDBConnection;
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      await expect(qb.rows()).rejects.toThrow("Query execution failed");
    });

    it("count() should propagate query errors", async () => {
      const conn = {
        query: vi.fn().mockRejectedValue(new Error("Count query failed")),
        insertArrowFromIPCStream: vi.fn().mockResolvedValue(undefined),
      } as unknown as AsyncDuckDBConnection;
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      await expect(qb.count()).rejects.toThrow("Count query failed");
    });

    it("preview() should propagate query errors", async () => {
      const conn = {
        query: vi.fn().mockRejectedValue(new Error("Preview failed")),
        insertArrowFromIPCStream: vi.fn().mockResolvedValue(undefined),
      } as unknown as AsyncDuckDBConnection;
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      await expect(qb.preview()).rejects.toThrow("Preview failed");
    });

    it("run() should propagate export errors", async () => {
      const conn = {
        query: vi.fn().mockRejectedValue(new Error("Export to Arrow failed")),
        insertArrowFromIPCStream: vi.fn().mockResolvedValue(undefined),
      } as unknown as AsyncDuckDBConnection;
      const qb = createTestQueryBuilder(mockDataFrame, conn);

      await expect(qb.run()).rejects.toThrow("Export to Arrow failed");
    });
  });
});
