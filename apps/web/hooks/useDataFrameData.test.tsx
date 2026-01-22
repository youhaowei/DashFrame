/**
 * Unit tests for useDataFrameData and useDataFrameDataByInsight hooks
 *
 * Tests cover:
 * - Data loading from DuckDB via DataFrame abstraction
 * - Pagination with limit option
 * - Skip option to prevent loading
 * - Reload functionality
 * - Error handling (missing DataFrame, connection errors, query errors)
 * - Column type inference from data
 * - Entry lookup from store
 * - Concurrent load prevention (mutex)
 * - useDataFrameDataByInsight variant (lookup by insightId)
 * - Hook stability and reference memoization
 */
import type { DataFrameEntry } from "@dashframe/core";
import type { DataFrameRow } from "@dashframe/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useDataFrameData,
  useDataFrameDataByInsight,
} from "./useDataFrameData";

// Mock DuckDB connection
const mockQuery = vi.fn();
const mockConnection = {
  query: mockQuery,
};

// Mock DuckDB provider
const mockUseDuckDB = vi.fn();

vi.mock("@/components/providers/DuckDBProvider", () => ({
  useDuckDB: () => mockUseDuckDB(),
}));

// Mock @dashframe/core
const mockGetDataFrame = vi.fn();
const mockUseDataFrames = vi.fn();

vi.mock("@dashframe/core", () => ({
  getDataFrame: mockGetDataFrame,
  useDataFrames: mockUseDataFrames,
}));

/**
 * Helper to create a mock DataFrame with load() method
 */
function createMockDataFrame(rows: DataFrameRow[]) {
  const mockLoad = vi.fn().mockResolvedValue({
    limit: vi.fn().mockReturnThis(),
    sql: vi.fn().mockResolvedValue("SELECT * FROM data"),
  });

  return {
    id: "df-123",
    load: mockLoad,
  };
}

/**
 * Helper to create a mock DuckDB query result
 */
function createMockQueryResult(rows: DataFrameRow[]) {
  return {
    toArray: vi.fn().mockReturnValue(rows),
  };
}

/**
 * Helper to create mock DataFrameEntry
 */
function createMockEntry(options: {
  id: string;
  insightId?: string;
  name?: string;
}): DataFrameEntry {
  return {
    id: options.id as any,
    insightId: options.insightId as any,
    name: options.name ?? "Test DataFrame",
    createdAt: Date.parse("2024-01-01T00:00:00.000Z"),
    storage: { type: "indexeddb", key: `df-${options.id}` },
    fieldIds: [],
  };
}

describe("useDataFrameData", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockUseDuckDB.mockReturnValue({
      connection: mockConnection,
      isInitialized: true,
      db: {},
      error: null,
    });

    mockUseDataFrames.mockReturnValue({
      data: [],
    });

    // Clear console.error mock
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("basic functionality", () => {
    it("should load data successfully", async () => {
      const mockRows = [
        { id: 1, name: "Alice", score: 95 },
        { id: 2, name: "Bob", score: 87 },
      ];

      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-123"));

      // Initially loading
      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toBeNull();

      // Wait for data to load
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).not.toBeNull();
      expect(result.current.data?.rows).toEqual(mockRows);
      expect(result.current.data?.columns).toHaveLength(3);
      expect(result.current.error).toBeNull();
    });

    it("should infer column types from data", async () => {
      const mockRows = [
        { id: 1, name: "Alice", active: true, joined: new Date("2024-01-01") },
        { id: 2, name: "Bob", active: false, joined: new Date("2024-01-02") },
      ];

      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-456"));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const columns = result.current.data?.columns;
      expect(columns).toBeDefined();
      expect(columns).toHaveLength(4);

      // Check inferred types
      expect(columns?.[0]).toEqual({ name: "id", type: "number" });
      expect(columns?.[1]).toEqual({ name: "name", type: "string" });
      expect(columns?.[2]).toEqual({ name: "active", type: "boolean" });
      expect(columns?.[3]).toEqual({ name: "joined", type: "date" });
    });

    it("should handle empty data", async () => {
      const mockRows: DataFrameRow[] = [];

      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-empty"));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).not.toBeNull();
      expect(result.current.data?.rows).toEqual([]);
      expect(result.current.data?.columns).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it("should return null when dataFrameId is undefined", () => {
      const { result } = renderHook(() => useDataFrameData(undefined));

      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("should find entry from store", async () => {
      const mockEntry = createMockEntry({
        id: "df-789",
        name: "Sales Data",
      });

      mockUseDataFrames.mockReturnValue({
        data: [mockEntry],
      });

      const mockRows = [{ id: 1 }];
      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-789"));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.entry).toEqual(mockEntry);
    });
  });

  describe("pagination (limit option)", () => {
    it("should apply default limit of 1000 rows", async () => {
      const mockRows = [{ id: 1 }];
      const mockDataFrame = createMockDataFrame(mockRows);
      const mockLimitFn = vi.fn().mockReturnThis();
      const mockSqlFn = vi
        .fn()
        .mockResolvedValue("SELECT * FROM data LIMIT 1000");

      mockDataFrame.load = vi.fn().mockResolvedValue({
        limit: mockLimitFn,
        sql: mockSqlFn,
      });

      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      renderHook(() => useDataFrameData("df-limit"));

      await waitFor(() => {
        expect(mockLimitFn).toHaveBeenCalledWith(1000);
      });
    });

    it("should apply custom limit", async () => {
      const mockRows = [{ id: 1 }];
      const mockDataFrame = createMockDataFrame(mockRows);
      const mockLimitFn = vi.fn().mockReturnThis();
      const mockSqlFn = vi
        .fn()
        .mockResolvedValue("SELECT * FROM data LIMIT 50");

      mockDataFrame.load = vi.fn().mockResolvedValue({
        limit: mockLimitFn,
        sql: mockSqlFn,
      });

      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      renderHook(() => useDataFrameData("df-limit-50", { limit: 50 }));

      await waitFor(() => {
        expect(mockLimitFn).toHaveBeenCalledWith(50);
      });
    });

    it("should skip limit clause when Infinity is passed", async () => {
      const mockRows = [{ id: 1 }];
      const mockQueryBuilder = {
        sql: vi.fn().mockResolvedValue("SELECT * FROM data"),
      };

      const mockDataFrame = createMockDataFrame(mockRows);
      mockDataFrame.load = vi.fn().mockResolvedValue(mockQueryBuilder);

      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      renderHook(() => useDataFrameData("df-all", { limit: Infinity }));

      await waitFor(() => {
        expect(mockQueryBuilder.sql).toHaveBeenCalled();
      });

      // Should NOT call limit() when Infinity is passed
      expect(mockQueryBuilder).not.toHaveProperty("limit");
    });

    it("should handle limit of 0 rows", async () => {
      const mockRows: DataFrameRow[] = [];
      const mockDataFrame = createMockDataFrame(mockRows);
      const mockLimitFn = vi.fn().mockReturnThis();
      const mockSqlFn = vi.fn().mockResolvedValue("SELECT * FROM data LIMIT 0");

      mockDataFrame.load = vi.fn().mockResolvedValue({
        limit: mockLimitFn,
        sql: mockSqlFn,
      });

      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      renderHook(() => useDataFrameData("df-zero", { limit: 0 }));

      await waitFor(() => {
        expect(mockLimitFn).toHaveBeenCalledWith(0);
      });
    });
  });

  describe("skip option", () => {
    it("should skip loading when skip=true", async () => {
      const { result } = renderHook(() =>
        useDataFrameData("df-skip", { skip: true }),
      );

      // Should not attempt to load
      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(mockGetDataFrame).not.toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("should load when skip=false", async () => {
      const mockRows = [{ id: 1 }];
      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      renderHook(() => useDataFrameData("df-no-skip", { skip: false }));

      await waitFor(() => {
        expect(mockGetDataFrame).toHaveBeenCalledWith("df-no-skip");
      });
    });

    it("should toggle skip option dynamically", async () => {
      const mockRows = [{ id: 1 }];
      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result, rerender } = renderHook(
        ({ skip }) => useDataFrameData("df-toggle", { skip }),
        { initialProps: { skip: true } },
      );

      // Initially skipped
      expect(mockGetDataFrame).not.toHaveBeenCalled();

      // Change to skip=false
      rerender({ skip: false });

      await waitFor(() => {
        expect(mockGetDataFrame).toHaveBeenCalledWith("df-toggle");
      });
    });
  });

  describe("error handling", () => {
    it("should handle DataFrame not found", async () => {
      mockGetDataFrame.mockResolvedValue(null);

      const { result } = renderHook(() => useDataFrameData("df-missing"));

      await waitFor(() => {
        expect(result.current.error).toBe("DataFrame not found: df-missing");
      });

      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it("should handle DuckDB connection not initialized", () => {
      mockUseDuckDB.mockReturnValue({
        connection: null,
        isInitialized: false,
        db: null,
        error: null,
      });

      const { result } = renderHook(() => useDataFrameData("df-no-conn"));

      // Should not attempt to load
      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(mockGetDataFrame).not.toHaveBeenCalled();
    });

    it("should handle query errors", async () => {
      const mockDataFrame = createMockDataFrame([]);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockRejectedValue(new Error("SQL syntax error"));

      const { result } = renderHook(() => useDataFrameData("df-query-error"));

      await waitFor(() => {
        expect(result.current.error).toBe("SQL syntax error");
      });

      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it("should handle load errors", async () => {
      const mockDataFrame = {
        id: "df-load-error",
        load: vi.fn().mockRejectedValue(new Error("Load failed")),
      };

      mockGetDataFrame.mockResolvedValue(mockDataFrame);

      const { result } = renderHook(() => useDataFrameData("df-load-error"));

      await waitFor(() => {
        expect(result.current.error).toBe("Load failed");
      });

      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it("should handle unknown error types", async () => {
      const mockDataFrame = createMockDataFrame([]);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockRejectedValue("Unknown error"); // String, not Error

      const { result } = renderHook(() => useDataFrameData("df-unknown-error"));

      await waitFor(() => {
        expect(result.current.error).toBe("Failed to load DataFrame");
      });
    });
  });

  describe("reload functionality", () => {
    it("should reload data when reload() is called", async () => {
      const mockRows = [{ id: 1, value: "original" }];
      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-reload"));

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data?.rows).toEqual(mockRows);

      // Change mock data for reload
      const newRows = [{ id: 1, value: "updated" }];
      mockQuery.mockResolvedValue(createMockQueryResult(newRows));

      // Trigger reload
      await act(async () => {
        result.current.reload();
      });

      await waitFor(() => {
        expect(result.current.data?.rows).toEqual(newRows);
      });

      // Should have called getDataFrame twice (initial + reload)
      expect(mockGetDataFrame).toHaveBeenCalledTimes(2);
    });

    it("should clear data and reload from scratch", async () => {
      const mockRows = [{ id: 1 }];
      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-clear-reload"));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Trigger reload
      await act(async () => {
        result.current.reload();
      });

      // Should have been called twice
      expect(mockGetDataFrame).toHaveBeenCalledTimes(2);
    });
  });

  describe("column type inference", () => {
    it("should infer 'number' type from numeric values", async () => {
      const mockRows = [{ score: 95 }, { score: 87.5 }, { score: 100 }];

      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-number"));

      await waitFor(() => {
        expect(result.current.data?.columns).toEqual([
          { name: "score", type: "number" },
        ]);
      });
    });

    it("should infer 'string' type from text values", async () => {
      const mockRows = [{ name: "Alice" }, { name: "Bob" }];

      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-string"));

      await waitFor(() => {
        expect(result.current.data?.columns).toEqual([
          { name: "name", type: "string" },
        ]);
      });
    });

    it("should infer 'boolean' type from boolean values", async () => {
      const mockRows = [{ active: true }, { active: false }];

      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-boolean"));

      await waitFor(() => {
        expect(result.current.data?.columns).toEqual([
          { name: "active", type: "boolean" },
        ]);
      });
    });

    it("should infer 'date' type from Date objects", async () => {
      const mockRows = [
        { created: new Date("2024-01-01") },
        { created: new Date("2024-01-02") },
      ];

      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-date"));

      await waitFor(() => {
        expect(result.current.data?.columns).toEqual([
          { name: "created", type: "date" },
        ]);
      });
    });

    it("should infer 'date' type from ISO date strings", async () => {
      const mockRows = [
        { timestamp: "2024-01-01T10:00:00Z" },
        { timestamp: "2024-01-02T15:30:00Z" },
      ];

      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-date-string"));

      await waitFor(() => {
        expect(result.current.data?.columns).toEqual([
          { name: "timestamp", type: "date" },
        ]);
      });
    });

    it("should infer 'unknown' type from all null values", async () => {
      const mockRows = [{ value: null }, { value: null }];

      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-unknown"));

      await waitFor(() => {
        expect(result.current.data?.columns).toEqual([
          { name: "value", type: "unknown" },
        ]);
      });
    });

    it("should skip null/undefined values when inferring types", async () => {
      const mockRows = [{ score: null }, { score: undefined }, { score: 95 }];

      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-mixed-null"));

      await waitFor(() => {
        expect(result.current.data?.columns).toEqual([
          { name: "score", type: "number" },
        ]);
      });
    });
  });

  describe("concurrent load prevention (mutex)", () => {
    it("should prevent concurrent loads of same DataFrame", async () => {
      const mockRows = [{ id: 1 }];
      const mockDataFrame = createMockDataFrame(mockRows);

      // Make load() take some time
      let resolveLoad: () => void;
      const loadPromise = new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });

      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockDataFrame.load = vi.fn().mockImplementation(async () => {
        await loadPromise;
        return {
          limit: vi.fn().mockReturnThis(),
          sql: vi.fn().mockResolvedValue("SELECT * FROM data"),
        };
      });
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      // Render two hooks with same ID simultaneously
      const { result: result1 } = renderHook(() =>
        useDataFrameData("df-mutex"),
      );
      const { result: result2 } = renderHook(() =>
        useDataFrameData("df-mutex"),
      );

      // Both should be loading
      expect(result1.current.isLoading).toBe(true);
      expect(result2.current.isLoading).toBe(true);

      // Resolve the load
      await act(async () => {
        resolveLoad!();
      });

      await waitFor(() => {
        expect(result1.current.isLoading).toBe(false);
        expect(result2.current.isLoading).toBe(false);
      });

      // Both should have data
      expect(result1.current.data).not.toBeNull();
      expect(result2.current.data).not.toBeNull();
    });
  });

  describe("dataFrameId changes", () => {
    it("should clear data when dataFrameId changes", async () => {
      const mockRows1 = [{ id: 1, name: "First" }];
      const mockRows2 = [{ id: 2, name: "Second" }];

      const mockDataFrame1 = createMockDataFrame(mockRows1);
      const mockDataFrame2 = createMockDataFrame(mockRows2);

      mockGetDataFrame
        .mockResolvedValueOnce(mockDataFrame1)
        .mockResolvedValueOnce(mockDataFrame2);
      mockQuery
        .mockResolvedValueOnce(createMockQueryResult(mockRows1))
        .mockResolvedValueOnce(createMockQueryResult(mockRows2));

      const { result, rerender } = renderHook(
        ({ id }) => useDataFrameData(id),
        { initialProps: { id: "df-1" } },
      );

      // Wait for first load
      await waitFor(() => {
        expect(result.current.data?.rows).toEqual(mockRows1);
      });

      // Change ID
      rerender({ id: "df-2" });

      // Data should be cleared
      expect(result.current.data).toBeNull();

      // Wait for second load
      await waitFor(() => {
        expect(result.current.data?.rows).toEqual(mockRows2);
      });
    });

    it("should not reload when dataFrameId stays the same", async () => {
      const mockRows = [{ id: 1 }];
      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result, rerender } = renderHook(
        ({ id }) => useDataFrameData(id),
        { initialProps: { id: "df-same" } },
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Clear mock calls
      mockGetDataFrame.mockClear();

      // Rerender with same ID
      rerender({ id: "df-same" });

      // Should not call getDataFrame again
      expect(mockGetDataFrame).not.toHaveBeenCalled();
    });
  });

  describe("hook stability", () => {
    it("should return stable reload function reference", async () => {
      const mockRows = [{ id: 1 }];
      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result, rerender } = renderHook(() =>
        useDataFrameData("df-stable"),
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const firstReload = result.current.reload;

      rerender();

      // Reload function should be the same reference (memoized with useCallback)
      expect(result.current.reload).toBe(firstReload);
    });

    it("should not recreate reload on unrelated rerenders", async () => {
      const mockRows = [{ id: 1 }];
      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result, rerender } = renderHook(() =>
        useDataFrameData("df-stable-2"),
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const originalReload = result.current.reload;

      // Trigger multiple rerenders
      rerender();
      rerender();
      rerender();

      expect(result.current.reload).toBe(originalReload);
    });
  });

  describe("type safety", () => {
    it("should return correct types for data", async () => {
      const mockRows = [{ id: 1, name: "Test" }];
      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-types"));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should have DataFrameData structure
      expect(result.current.data).toHaveProperty("rows");
      expect(result.current.data).toHaveProperty("columns");
      expect(Array.isArray(result.current.data?.rows)).toBe(true);
      expect(Array.isArray(result.current.data?.columns)).toBe(true);
    });

    it("should handle null data state", () => {
      const { result } = renderHook(() => useDataFrameData(undefined));

      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("should return entry with correct type", async () => {
      const mockEntry = createMockEntry({
        id: "df-entry",
        insightId: "insight-123",
      });

      mockUseDataFrames.mockReturnValue({
        data: [mockEntry],
      });

      const mockRows = [{ id: 1 }];
      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() => useDataFrameData("df-entry"));

      await waitFor(() => {
        expect(result.current.entry).toEqual(mockEntry);
      });
    });
  });
});

describe("useDataFrameDataByInsight", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockUseDuckDB.mockReturnValue({
      connection: mockConnection,
      isInitialized: true,
      db: {},
      error: null,
    });

    mockUseDataFrames.mockReturnValue({
      data: [],
    });

    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("basic functionality", () => {
    it("should find DataFrame by insightId", async () => {
      const mockEntry = createMockEntry({
        id: "df-123",
        insightId: "insight-abc",
      });

      mockUseDataFrames.mockReturnValue({
        data: [mockEntry],
      });

      const mockRows = [{ id: 1, value: "test" }];
      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() =>
        useDataFrameDataByInsight("insight-abc"),
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).not.toBeNull();
      expect(result.current.entry).toEqual(mockEntry);
      expect(mockGetDataFrame).toHaveBeenCalledWith("df-123");
    });

    it("should return null when insightId is undefined", () => {
      const { result } = renderHook(() => useDataFrameDataByInsight(undefined));

      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("should return null when DataFrame not found for insightId", async () => {
      mockUseDataFrames.mockReturnValue({
        data: [createMockEntry({ id: "df-other", insightId: "insight-other" })],
      });

      const { result } = renderHook(() =>
        useDataFrameDataByInsight("insight-missing"),
      );

      // Should not attempt to load
      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(mockGetDataFrame).not.toHaveBeenCalled();
    });

    it("should pass options to useDataFrameData", async () => {
      const mockEntry = createMockEntry({
        id: "df-options",
        insightId: "insight-options",
      });

      mockUseDataFrames.mockReturnValue({
        data: [mockEntry],
      });

      const mockRows = [{ id: 1 }];
      const mockDataFrame = createMockDataFrame(mockRows);
      const mockLimitFn = vi.fn().mockReturnThis();
      const mockSqlFn = vi
        .fn()
        .mockResolvedValue("SELECT * FROM data LIMIT 100");

      mockDataFrame.load = vi.fn().mockResolvedValue({
        limit: mockLimitFn,
        sql: mockSqlFn,
      });

      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      renderHook(() =>
        useDataFrameDataByInsight("insight-options", { limit: 100 }),
      );

      await waitFor(() => {
        expect(mockLimitFn).toHaveBeenCalledWith(100);
      });
    });

    it("should respect skip option", () => {
      const mockEntry = createMockEntry({
        id: "df-skip",
        insightId: "insight-skip",
      });

      mockUseDataFrames.mockReturnValue({
        data: [mockEntry],
      });

      const { result } = renderHook(() =>
        useDataFrameDataByInsight("insight-skip", { skip: true }),
      );

      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(mockGetDataFrame).not.toHaveBeenCalled();
    });
  });

  describe("integration with useDataFrameData", () => {
    it("should support reload functionality", async () => {
      const mockEntry = createMockEntry({
        id: "df-reload",
        insightId: "insight-reload",
      });

      mockUseDataFrames.mockReturnValue({
        data: [mockEntry],
      });

      const mockRows = [{ id: 1, value: "original" }];
      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() =>
        useDataFrameDataByInsight("insight-reload"),
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Change mock data
      const newRows = [{ id: 1, value: "updated" }];
      mockQuery.mockResolvedValue(createMockQueryResult(newRows));

      // Trigger reload
      await act(async () => {
        result.current.reload();
      });

      await waitFor(() => {
        expect(result.current.data?.rows).toEqual(newRows);
      });
    });

    it("should handle errors from underlying hook", async () => {
      const mockEntry = createMockEntry({
        id: "df-error",
        insightId: "insight-error",
      });

      mockUseDataFrames.mockReturnValue({
        data: [mockEntry],
      });

      mockGetDataFrame.mockResolvedValue(null);

      const { result } = renderHook(() =>
        useDataFrameDataByInsight("insight-error"),
      );

      await waitFor(() => {
        expect(result.current.error).toBe("DataFrame not found: df-error");
      });

      expect(result.current.data).toBeNull();
    });
  });

  describe("type safety", () => {
    it("should return same result type as useDataFrameData", async () => {
      const mockEntry = createMockEntry({
        id: "df-type",
        insightId: "insight-type",
      });

      mockUseDataFrames.mockReturnValue({
        data: [mockEntry],
      });

      const mockRows = [{ id: 1 }];
      const mockDataFrame = createMockDataFrame(mockRows);
      mockGetDataFrame.mockResolvedValue(mockDataFrame);
      mockQuery.mockResolvedValue(createMockQueryResult(mockRows));

      const { result } = renderHook(() =>
        useDataFrameDataByInsight("insight-type"),
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should have all UseDataFrameDataResult properties
      expect(result.current).toHaveProperty("data");
      expect(result.current).toHaveProperty("isLoading");
      expect(result.current).toHaveProperty("error");
      expect(result.current).toHaveProperty("entry");
      expect(result.current).toHaveProperty("reload");
    });
  });
});
