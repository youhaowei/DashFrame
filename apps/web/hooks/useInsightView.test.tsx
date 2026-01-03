/**
 * Unit tests for useInsightView hook and related cache functions
 *
 * Tests cover:
 * - Module-level cache functions (clearInsightViewCache, getCachedViewName)
 * - DuckDB view creation for insights
 * - Join handling (single and multiple joins)
 * - Cache behavior and reuse
 * - Concurrent request prevention (mutex)
 * - Error handling (missing tables, missing DataFrames, SQL build errors, query errors)
 * - Configuration changes (insight ID changes, join changes)
 * - DuckDB connection requirements
 * - View name format and uniqueness
 */
import type { DataTable, Insight } from "@dashframe/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearInsightViewCache,
  getCachedViewName,
  useInsightView,
} from "./useInsightView";

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
const mockGetDataTable = vi.fn();

vi.mock("@dashframe/core", () => ({
  getDataFrame: mockGetDataFrame,
  getDataTable: mockGetDataTable,
}));

// Mock @dashframe/engine-browser
const mockBuildInsightSQL = vi.fn();
const mockEnsureTableLoaded = vi.fn();

vi.mock("@dashframe/engine-browser", () => ({
  buildInsightSQL: mockBuildInsightSQL,
  ensureTableLoaded: mockEnsureTableLoaded,
}));

/**
 * Helper to create a mock Insight object
 */
function createMockInsight(options: {
  id?: string;
  name?: string;
  baseTableId?: string;
  joins?: Insight["joins"];
}): Insight {
  return {
    id: options.id ?? "insight-123",
    name: options.name ?? "Test Insight",
    baseTableId: options.baseTableId ?? "table-abc",
    selectedFields: [],
    metrics: [],
    joins: options.joins ?? [],
    filters: [],
    sorts: [],
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  };
}

/**
 * Helper to create a mock DataTable object
 */
function createMockDataTable(options: {
  id?: string;
  name?: string;
  dataFrameId?: string;
}): DataTable {
  return {
    id: options.id ?? "table-abc",
    name: options.name ?? "Test Table",
    dataSourceId: "ds-123",
    dataFrameId: options.dataFrameId ?? "df-123",
    fields: [],
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  };
}

/**
 * Helper to create a mock DataFrame object
 */
function createMockDataFrame(id: string) {
  return {
    id,
    name: `DataFrame ${id}`,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
  };
}

describe("clearInsightViewCache", () => {
  it("should clear the view cache", () => {
    // Create a view to populate the cache
    const insight = createMockInsight({
      id: "insight-clear-test",
      baseTableId: "table-clear",
    });

    const baseTable = createMockDataTable({
      id: "table-clear",
      dataFrameId: "df-clear",
    });

    const baseDataFrame = createMockDataFrame("df-clear");

    mockUseDuckDB.mockReturnValue({
      connection: mockConnection,
      isInitialized: true,
      db: {},
      error: null,
    });

    mockGetDataTable.mockResolvedValue(baseTable);
    mockGetDataFrame.mockResolvedValue(baseDataFrame);
    mockEnsureTableLoaded.mockResolvedValue(undefined);
    mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
    mockQuery.mockResolvedValue(undefined);

    // Render hook to populate cache
    renderHook(() => useInsightView(insight));

    // Clear the cache
    clearInsightViewCache();

    // getCachedViewName should return null after clearing
    expect(getCachedViewName("insight-clear-test")).toBeNull();
  });
});

describe("getCachedViewName", () => {
  beforeEach(() => {
    clearInsightViewCache();
    vi.clearAllMocks();
  });

  it("should return null for non-existent insight", () => {
    expect(getCachedViewName("non-existent")).toBeNull();
  });

  it("should return cached view name for existing insight", async () => {
    const insight = createMockInsight({
      id: "insight-cached",
      baseTableId: "table-cached",
    });

    const baseTable = createMockDataTable({
      id: "table-cached",
      dataFrameId: "df-cached",
    });

    const baseDataFrame = createMockDataFrame("df-cached");

    mockUseDuckDB.mockReturnValue({
      connection: mockConnection,
      isInitialized: true,
      db: {},
      error: null,
    });

    mockGetDataTable.mockResolvedValue(baseTable);
    mockGetDataFrame.mockResolvedValue(baseDataFrame);
    mockEnsureTableLoaded.mockResolvedValue(undefined);
    mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
    mockQuery.mockResolvedValue(undefined);

    const { result } = renderHook(() => useInsightView(insight));

    // Wait for view to be created
    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    // getCachedViewName should now return the view name
    const cachedName = getCachedViewName("insight-cached");
    expect(cachedName).toBe("insight_view_insight_cached");
  });

  it("should match by insight ID prefix", async () => {
    const insight = createMockInsight({
      id: "insight-prefix-test",
      baseTableId: "table-prefix",
      joins: [
        {
          rightTableId: "table-right",
          leftKey: "id",
          rightKey: "fk_id",
          type: "left",
        },
      ],
    });

    const baseTable = createMockDataTable({
      id: "table-prefix",
      dataFrameId: "df-prefix",
    });

    const rightTable = createMockDataTable({
      id: "table-right",
      dataFrameId: "df-right",
    });

    const baseDataFrame = createMockDataFrame("df-prefix");
    const rightDataFrame = createMockDataFrame("df-right");

    mockUseDuckDB.mockReturnValue({
      connection: mockConnection,
      isInitialized: true,
      db: {},
      error: null,
    });

    mockGetDataTable.mockImplementation((id) => {
      if (id === "table-prefix") return Promise.resolve(baseTable);
      if (id === "table-right") return Promise.resolve(rightTable);
      return Promise.resolve(null);
    });

    mockGetDataFrame.mockImplementation((id) => {
      if (id === "df-prefix") return Promise.resolve(baseDataFrame);
      if (id === "df-right") return Promise.resolve(rightDataFrame);
      return Promise.resolve(null);
    });

    mockEnsureTableLoaded.mockResolvedValue(undefined);
    mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
    mockQuery.mockResolvedValue(undefined);

    const { result } = renderHook(() => useInsightView(insight));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    // getCachedViewName should match by ID prefix even though joins differ
    const cachedName = getCachedViewName("insight-prefix-test");
    expect(cachedName).toBe("insight_view_insight_prefix_test");
  });
});

describe("useInsightView", () => {
  beforeEach(() => {
    clearInsightViewCache();
    vi.clearAllMocks();

    // Default mock implementations
    mockUseDuckDB.mockReturnValue({
      connection: mockConnection,
      isInitialized: true,
      db: {},
      error: null,
    });

    // Clear console.error mock
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("basic functionality", () => {
    it("should create view successfully for simple insight", async () => {
      const insight = createMockInsight({
        id: "insight-simple",
        baseTableId: "table-simple",
      });

      const baseTable = createMockDataTable({
        id: "table-simple",
        dataFrameId: "df-simple",
      });

      const baseDataFrame = createMockDataFrame("df-simple");

      mockGetDataTable.mockResolvedValue(baseTable);
      mockGetDataFrame.mockResolvedValue(baseDataFrame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockResolvedValue(undefined);

      const { result } = renderHook(() => useInsightView(insight));

      // Initially not ready
      expect(result.current.isReady).toBe(false);
      expect(result.current.viewName).toBeNull();

      // Wait for view to be created
      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      expect(result.current.viewName).toBe("insight_view_insight_simple");
      expect(result.current.error).toBeNull();

      // Verify CREATE OR REPLACE VIEW was called
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE OR REPLACE VIEW "insight_view_insight_simple" AS'),
      );
    });

    it("should handle insight with hyphens in ID by replacing with underscores", async () => {
      const insight = createMockInsight({
        id: "insight-with-many-hyphens",
        baseTableId: "table-hyphens",
      });

      const baseTable = createMockDataTable({
        id: "table-hyphens",
        dataFrameId: "df-hyphens",
      });

      const baseDataFrame = createMockDataFrame("df-hyphens");

      mockGetDataTable.mockResolvedValue(baseTable);
      mockGetDataFrame.mockResolvedValue(baseDataFrame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockResolvedValue(undefined);

      const { result } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      expect(result.current.viewName).toBe(
        "insight_view_insight_with_many_hyphens",
      );
    });

    it("should return not ready when insight is null", () => {
      const { result } = renderHook(() => useInsightView(null));

      expect(result.current.isReady).toBe(false);
      expect(result.current.viewName).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it("should return not ready when insight is undefined", () => {
      const { result } = renderHook(() => useInsightView(undefined));

      expect(result.current.isReady).toBe(false);
      expect(result.current.viewName).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe("cache behavior", () => {
    it("should reuse cached view on subsequent renders", async () => {
      const insight = createMockInsight({
        id: "insight-reuse",
        baseTableId: "table-reuse",
      });

      const baseTable = createMockDataTable({
        id: "table-reuse",
        dataFrameId: "df-reuse",
      });

      const baseDataFrame = createMockDataFrame("df-reuse");

      mockGetDataTable.mockResolvedValue(baseTable);
      mockGetDataFrame.mockResolvedValue(baseDataFrame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockResolvedValue(undefined);

      // First render
      const { result: result1, unmount } = renderHook(() =>
        useInsightView(insight),
      );

      await waitFor(() => {
        expect(result1.current.isReady).toBe(true);
      });

      const viewName1 = result1.current.viewName;
      expect(viewName1).toBe("insight_view_insight_reuse");

      // Clear mocks to track second render
      const queryCallCount = mockQuery.mock.calls.length;
      unmount();

      // Second render with same insight
      const { result: result2 } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result2.current.isReady).toBe(true);
      });

      // Should return same view name
      expect(result2.current.viewName).toBe(viewName1);

      // Should NOT create view again
      expect(mockQuery.mock.calls.length).toBe(queryCallCount);
    });

    it("should create new view when insight ID changes", async () => {
      const insight1 = createMockInsight({
        id: "insight-first",
        baseTableId: "table-first",
      });

      const insight2 = createMockInsight({
        id: "insight-second",
        baseTableId: "table-second",
      });

      const baseTable1 = createMockDataTable({
        id: "table-first",
        dataFrameId: "df-first",
      });

      const baseTable2 = createMockDataTable({
        id: "table-second",
        dataFrameId: "df-second",
      });

      const baseDataFrame1 = createMockDataFrame("df-first");
      const baseDataFrame2 = createMockDataFrame("df-second");

      mockGetDataTable.mockImplementation((id) => {
        if (id === "table-first") return Promise.resolve(baseTable1);
        if (id === "table-second") return Promise.resolve(baseTable2);
        return Promise.resolve(null);
      });

      mockGetDataFrame.mockImplementation((id) => {
        if (id === "df-first") return Promise.resolve(baseDataFrame1);
        if (id === "df-second") return Promise.resolve(baseDataFrame2);
        return Promise.resolve(null);
      });

      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockResolvedValue(undefined);

      const { result, rerender } = renderHook(
        ({ insight }) => useInsightView(insight),
        { initialProps: { insight: insight1 } },
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      expect(result.current.viewName).toBe("insight_view_insight_first");

      // Change insight
      rerender({ insight: insight2 });

      await waitFor(() => {
        expect(result.current.viewName).toBe("insight_view_insight_second");
      });

      expect(result.current.isReady).toBe(true);
    });

    it("should create new view when joins change", async () => {
      const insightNoJoins = createMockInsight({
        id: "insight-joins-change",
        baseTableId: "table-base",
        joins: [],
      });

      const insightWithJoins = createMockInsight({
        id: "insight-joins-change",
        baseTableId: "table-base",
        joins: [
          {
            rightTableId: "table-right",
            leftKey: "id",
            rightKey: "fk_id",
            type: "left",
          },
        ],
      });

      const baseTable = createMockDataTable({
        id: "table-base",
        dataFrameId: "df-base",
      });

      const rightTable = createMockDataTable({
        id: "table-right",
        dataFrameId: "df-right",
      });

      const baseDataFrame = createMockDataFrame("df-base");
      const rightDataFrame = createMockDataFrame("df-right");

      mockGetDataTable.mockImplementation((id) => {
        if (id === "table-base") return Promise.resolve(baseTable);
        if (id === "table-right") return Promise.resolve(rightTable);
        return Promise.resolve(null);
      });

      mockGetDataFrame.mockImplementation((id) => {
        if (id === "df-base") return Promise.resolve(baseDataFrame);
        if (id === "df-right") return Promise.resolve(rightDataFrame);
        return Promise.resolve(null);
      });

      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockResolvedValue(undefined);

      const { result, rerender } = renderHook(
        ({ insight }) => useInsightView(insight),
        { initialProps: { insight: insightNoJoins } },
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      const queryCallCountBefore = mockQuery.mock.calls.length;

      // Change joins
      rerender({ insight: insightWithJoins });

      await waitFor(() => {
        expect(mockQuery.mock.calls.length).toBeGreaterThan(
          queryCallCountBefore,
        );
      });

      expect(result.current.isReady).toBe(true);
    });
  });

  describe("join handling", () => {
    it("should load single join table and create view", async () => {
      const insight = createMockInsight({
        id: "insight-single-join",
        baseTableId: "table-base",
        joins: [
          {
            rightTableId: "table-right",
            leftKey: "id",
            rightKey: "fk_id",
            type: "left",
          },
        ],
      });

      const baseTable = createMockDataTable({
        id: "table-base",
        dataFrameId: "df-base",
      });

      const rightTable = createMockDataTable({
        id: "table-right",
        dataFrameId: "df-right",
      });

      const baseDataFrame = createMockDataFrame("df-base");
      const rightDataFrame = createMockDataFrame("df-right");

      mockGetDataTable.mockImplementation((id) => {
        if (id === "table-base") return Promise.resolve(baseTable);
        if (id === "table-right") return Promise.resolve(rightTable);
        return Promise.resolve(null);
      });

      mockGetDataFrame.mockImplementation((id) => {
        if (id === "df-base") return Promise.resolve(baseDataFrame);
        if (id === "df-right") return Promise.resolve(rightDataFrame);
        return Promise.resolve(null);
      });

      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockResolvedValue(undefined);

      const { result } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      // Verify both DataFrames were loaded
      expect(mockEnsureTableLoaded).toHaveBeenCalledTimes(2);
      expect(mockEnsureTableLoaded).toHaveBeenCalledWith(
        baseDataFrame,
        mockConnection,
      );
      expect(mockEnsureTableLoaded).toHaveBeenCalledWith(
        rightDataFrame,
        mockConnection,
      );

      // Verify buildInsightSQL was called with joined tables
      expect(mockBuildInsightSQL).toHaveBeenCalledWith(
        baseTable,
        expect.any(Map),
        expect.objectContaining({ joins: insight.joins }),
        { mode: "model" },
      );

      expect(result.current.viewName).toBe("insight_view_insight_single_join");
    });

    it("should load multiple join tables and create view", async () => {
      const insight = createMockInsight({
        id: "insight-multi-join",
        baseTableId: "table-base",
        joins: [
          {
            rightTableId: "table-right-1",
            leftKey: "id",
            rightKey: "fk_id",
            type: "left",
          },
          {
            rightTableId: "table-right-2",
            leftKey: "id",
            rightKey: "fk_id",
            type: "left",
          },
        ],
      });

      const baseTable = createMockDataTable({
        id: "table-base",
        dataFrameId: "df-base",
      });

      const rightTable1 = createMockDataTable({
        id: "table-right-1",
        dataFrameId: "df-right-1",
      });

      const rightTable2 = createMockDataTable({
        id: "table-right-2",
        dataFrameId: "df-right-2",
      });

      const baseDataFrame = createMockDataFrame("df-base");
      const rightDataFrame1 = createMockDataFrame("df-right-1");
      const rightDataFrame2 = createMockDataFrame("df-right-2");

      mockGetDataTable.mockImplementation((id) => {
        if (id === "table-base") return Promise.resolve(baseTable);
        if (id === "table-right-1") return Promise.resolve(rightTable1);
        if (id === "table-right-2") return Promise.resolve(rightTable2);
        return Promise.resolve(null);
      });

      mockGetDataFrame.mockImplementation((id) => {
        if (id === "df-base") return Promise.resolve(baseDataFrame);
        if (id === "df-right-1") return Promise.resolve(rightDataFrame1);
        if (id === "df-right-2") return Promise.resolve(rightDataFrame2);
        return Promise.resolve(null);
      });

      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockResolvedValue(undefined);

      const { result } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      // Verify all three DataFrames were loaded (base + 2 joins)
      expect(mockEnsureTableLoaded).toHaveBeenCalledTimes(3);
      expect(mockEnsureTableLoaded).toHaveBeenCalledWith(
        baseDataFrame,
        mockConnection,
      );
      expect(mockEnsureTableLoaded).toHaveBeenCalledWith(
        rightDataFrame1,
        mockConnection,
      );
      expect(mockEnsureTableLoaded).toHaveBeenCalledWith(
        rightDataFrame2,
        mockConnection,
      );

      expect(result.current.viewName).toBe("insight_view_insight_multi_join");
    });

    it("should handle join table not found gracefully", async () => {
      const insight = createMockInsight({
        id: "insight-join-missing",
        baseTableId: "table-base",
        joins: [
          {
            rightTableId: "table-missing",
            leftKey: "id",
            rightKey: "fk_id",
            type: "left",
          },
        ],
      });

      const baseTable = createMockDataTable({
        id: "table-base",
        dataFrameId: "df-base",
      });

      const baseDataFrame = createMockDataFrame("df-base");

      mockGetDataTable.mockImplementation((id) => {
        if (id === "table-base") return Promise.resolve(baseTable);
        if (id === "table-missing") return Promise.resolve(null); // Join table not found
        return Promise.resolve(null);
      });

      mockGetDataFrame.mockResolvedValue(baseDataFrame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockResolvedValue(undefined);

      const { result } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      // Should still create view, just without the missing join
      expect(result.current.viewName).toBe("insight_view_insight_join_missing");
      expect(result.current.error).toBeNull();
    });

    it("should handle join table without dataFrameId", async () => {
      const insight = createMockInsight({
        id: "insight-join-no-df",
        baseTableId: "table-base",
        joins: [
          {
            rightTableId: "table-no-df",
            leftKey: "id",
            rightKey: "fk_id",
            type: "left",
          },
        ],
      });

      const baseTable = createMockDataTable({
        id: "table-base",
        dataFrameId: "df-base",
      });

      const rightTableNoDf = createMockDataTable({
        id: "table-no-df",
        dataFrameId: undefined, // No DataFrame
      });

      const baseDataFrame = createMockDataFrame("df-base");

      mockGetDataTable.mockImplementation((id) => {
        if (id === "table-base") return Promise.resolve(baseTable);
        if (id === "table-no-df") return Promise.resolve(rightTableNoDf);
        return Promise.resolve(null);
      });

      mockGetDataFrame.mockResolvedValue(baseDataFrame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockResolvedValue(undefined);

      const { result } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      // Should still create view
      expect(result.current.viewName).toBe("insight_view_insight_join_no_df");
      expect(result.current.error).toBeNull();
    });
  });

  describe("error handling", () => {
    it("should handle base table not found", async () => {
      const insight = createMockInsight({
        id: "insight-no-table",
        baseTableId: "table-missing",
      });

      mockGetDataTable.mockResolvedValue(null); // Table not found

      const { result } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result.current.error).toBe("Base table not found");
      });

      expect(result.current.isReady).toBe(false);
      expect(result.current.viewName).toBeNull();
    });

    it("should handle base table without dataFrameId", async () => {
      const insight = createMockInsight({
        id: "insight-no-df-id",
        baseTableId: "table-no-df",
      });

      const baseTableNoDf = createMockDataTable({
        id: "table-no-df",
        dataFrameId: undefined, // No DataFrame ID
      });

      mockGetDataTable.mockResolvedValue(baseTableNoDf);

      const { result } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result.current.error).toBe("Base table not found");
      });

      expect(result.current.isReady).toBe(false);
      expect(result.current.viewName).toBeNull();
    });

    it("should handle base DataFrame not found", async () => {
      const insight = createMockInsight({
        id: "insight-no-df",
        baseTableId: "table-base",
      });

      const baseTable = createMockDataTable({
        id: "table-base",
        dataFrameId: "df-missing",
      });

      mockGetDataTable.mockResolvedValue(baseTable);
      mockGetDataFrame.mockResolvedValue(null); // DataFrame not found

      const { result } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result.current.error).toBe("Base DataFrame not found");
      });

      expect(result.current.isReady).toBe(false);
      expect(result.current.viewName).toBeNull();
    });

    it("should handle SQL build failure", async () => {
      const insight = createMockInsight({
        id: "insight-sql-fail",
        baseTableId: "table-base",
      });

      const baseTable = createMockDataTable({
        id: "table-base",
        dataFrameId: "df-base",
      });

      const baseDataFrame = createMockDataFrame("df-base");

      mockGetDataTable.mockResolvedValue(baseTable);
      mockGetDataFrame.mockResolvedValue(baseDataFrame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue(null); // SQL build failed

      const { result } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result.current.error).toBe("Failed to build SQL for insight view");
      });

      expect(result.current.isReady).toBe(false);
      expect(result.current.viewName).toBeNull();
    });

    it("should handle DuckDB query error", async () => {
      const insight = createMockInsight({
        id: "insight-query-error",
        baseTableId: "table-base",
      });

      const baseTable = createMockDataTable({
        id: "table-base",
        dataFrameId: "df-base",
      });

      const baseDataFrame = createMockDataFrame("df-base");

      mockGetDataTable.mockResolvedValue(baseTable);
      mockGetDataFrame.mockResolvedValue(baseDataFrame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockRejectedValue(new Error("Query execution failed"));

      const { result } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result.current.error).toBe("Query execution failed");
      });

      expect(result.current.isReady).toBe(false);
      expect(result.current.viewName).toBeNull();
    });

    it("should handle ensureTableLoaded error", async () => {
      const insight = createMockInsight({
        id: "insight-load-error",
        baseTableId: "table-base",
      });

      const baseTable = createMockDataTable({
        id: "table-base",
        dataFrameId: "df-base",
      });

      const baseDataFrame = createMockDataFrame("df-base");

      mockGetDataTable.mockResolvedValue(baseTable);
      mockGetDataFrame.mockResolvedValue(baseDataFrame);
      mockEnsureTableLoaded.mockRejectedValue(
        new Error("Failed to load table"),
      );

      const { result } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result.current.error).toBe("Failed to load table");
      });

      expect(result.current.isReady).toBe(false);
      expect(result.current.viewName).toBeNull();
    });

    it("should handle non-Error exceptions", async () => {
      const insight = createMockInsight({
        id: "insight-string-error",
        baseTableId: "table-base",
      });

      const baseTable = createMockDataTable({
        id: "table-base",
        dataFrameId: "df-base",
      });

      const baseDataFrame = createMockDataFrame("df-base");

      mockGetDataTable.mockResolvedValue(baseTable);
      mockGetDataFrame.mockResolvedValue(baseDataFrame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockRejectedValue("String error"); // Non-Error exception

      const { result } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result.current.error).toBe("Failed to create view");
      });

      expect(result.current.isReady).toBe(false);
      expect(result.current.viewName).toBeNull();
    });
  });

  describe("DuckDB connection requirements", () => {
    it("should not create view when connection is null", () => {
      mockUseDuckDB.mockReturnValue({
        connection: null,
        isInitialized: false,
        db: null,
        error: null,
      });

      const insight = createMockInsight({
        id: "insight-no-conn",
        baseTableId: "table-base",
      });

      const { result } = renderHook(() => useInsightView(insight));

      expect(result.current.isReady).toBe(false);
      expect(result.current.viewName).toBeNull();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("should not create view when DuckDB is not initialized", () => {
      mockUseDuckDB.mockReturnValue({
        connection: mockConnection,
        isInitialized: false,
        db: {},
        error: null,
      });

      const insight = createMockInsight({
        id: "insight-not-init",
        baseTableId: "table-base",
      });

      const { result } = renderHook(() => useInsightView(insight));

      expect(result.current.isReady).toBe(false);
      expect(result.current.viewName).toBeNull();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("should create view when DuckDB becomes initialized", async () => {
      // Start with DuckDB not initialized
      mockUseDuckDB.mockReturnValue({
        connection: null,
        isInitialized: false,
        db: null,
        error: null,
      });

      const insight = createMockInsight({
        id: "insight-late-init",
        baseTableId: "table-late",
      });

      const baseTable = createMockDataTable({
        id: "table-late",
        dataFrameId: "df-late",
      });

      const baseDataFrame = createMockDataFrame("df-late");

      mockGetDataTable.mockResolvedValue(baseTable);
      mockGetDataFrame.mockResolvedValue(baseDataFrame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockResolvedValue(undefined);

      const { result, rerender } = renderHook(() => useInsightView(insight));

      expect(result.current.isReady).toBe(false);

      // DuckDB becomes initialized
      await act(async () => {
        mockUseDuckDB.mockReturnValue({
          connection: mockConnection,
          isInitialized: true,
          db: {},
          error: null,
        });
        rerender();
      });

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      expect(result.current.viewName).toBe("insight_view_insight_late_init");
    });
  });

  describe("concurrent request prevention", () => {
    it("should prevent duplicate view creation for same config", async () => {
      const insight = createMockInsight({
        id: "insight-concurrent",
        baseTableId: "table-concurrent",
      });

      const baseTable = createMockDataTable({
        id: "table-concurrent",
        dataFrameId: "df-concurrent",
      });

      const baseDataFrame = createMockDataFrame("df-concurrent");

      mockGetDataTable.mockResolvedValue(baseTable);
      mockGetDataFrame.mockResolvedValue(baseDataFrame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");

      // Make query take some time to complete
      mockQuery.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(undefined), 100);
          }),
      );

      // Render two hooks simultaneously
      const { result: result1 } = renderHook(() => useInsightView(insight));
      const { result: result2 } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result1.current.isReady).toBe(true);
        expect(result2.current.isReady).toBe(true);
      });

      // Both should have the same view name
      expect(result1.current.viewName).toBe("insight_view_insight_concurrent");
      expect(result2.current.viewName).toBe("insight_view_insight_concurrent");

      // Query should only be called once (not twice)
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe("configuration changes", () => {
    it("should reset state when insight becomes null", async () => {
      const insight = createMockInsight({
        id: "insight-becomes-null",
        baseTableId: "table-base",
      });

      const baseTable = createMockDataTable({
        id: "table-base",
        dataFrameId: "df-base",
      });

      const baseDataFrame = createMockDataFrame("df-base");

      mockGetDataTable.mockResolvedValue(baseTable);
      mockGetDataFrame.mockResolvedValue(baseDataFrame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockResolvedValue(undefined);

      const { result, rerender } = renderHook(
        ({ insight }) => useInsightView(insight),
        { initialProps: { insight } },
      );

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      expect(result.current.viewName).toBe("insight_view_insight_becomes_null");

      // Change insight to null
      rerender({ insight: null });

      expect(result.current.isReady).toBe(false);
      expect(result.current.viewName).toBeNull();
    });

    it("should reset state when baseTableId is missing", () => {
      const insightNoBaseTable = createMockInsight({
        id: "insight-no-base",
        baseTableId: undefined as any, // Force undefined
      });

      const { result } = renderHook(() => useInsightView(insightNoBaseTable));

      expect(result.current.isReady).toBe(false);
      expect(result.current.viewName).toBeNull();
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("view name format", () => {
    it("should format view name with underscores", async () => {
      const insight = createMockInsight({
        id: "abc-def-ghi",
        baseTableId: "table-base",
      });

      const baseTable = createMockDataTable({
        id: "table-base",
        dataFrameId: "df-base",
      });

      const baseDataFrame = createMockDataFrame("df-base");

      mockGetDataTable.mockResolvedValue(baseTable);
      mockGetDataFrame.mockResolvedValue(baseDataFrame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockResolvedValue(undefined);

      const { result } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      expect(result.current.viewName).toBe("insight_view_abc_def_ghi");
    });
  });

  describe("SQL generation", () => {
    it("should call buildInsightSQL with mode: model", async () => {
      const insight = createMockInsight({
        id: "insight-sql-mode",
        baseTableId: "table-base",
      });

      const baseTable = createMockDataTable({
        id: "table-base",
        dataFrameId: "df-base",
      });

      const baseDataFrame = createMockDataFrame("df-base");

      mockGetDataTable.mockResolvedValue(baseTable);
      mockGetDataFrame.mockResolvedValue(baseDataFrame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM test");
      mockQuery.mockResolvedValue(undefined);

      const { result } = renderHook(() => useInsightView(insight));

      await waitFor(() => {
        expect(result.current.isReady).toBe(true);
      });

      expect(mockBuildInsightSQL).toHaveBeenCalledWith(
        baseTable,
        expect.any(Map),
        expect.objectContaining({ joins: [] }),
        { mode: "model" },
      );
    });
  });
});
