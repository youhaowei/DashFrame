/**
 * Unit tests for useInsightPagination hook — stale-state guard
 *
 * The critical invariant: when the insight config changes (or the hook is
 * re-rendered with a new insight) before the previous async init completes,
 * only the NEW config's data (totalCount, isReady) must be exposed.  The
 * previous in-flight init must detect it was superseded and discard its
 * results without calling setState.
 *
 * Contract under test:
 *   render with insight A (slow init) → re-render with insight B (fast init)
 *   → B settles first → release A → only B's count/readiness is visible; A's
 *   data never surfaces.
 */
import type { DataTable, Insight } from "@dashframe/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInsightPagination } from "./useInsightPagination";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockConnection, mockUseDuckDB } = vi.hoisted(() => {
  const query = vi.fn();
  return {
    mockConnection: { query },
    mockUseDuckDB: vi.fn(),
  };
});

vi.mock("@/components/providers/DuckDBProvider", () => ({
  useDuckDB: () => mockUseDuckDB(),
}));

const { mockGetDataFrame, mockGetDataTable } = vi.hoisted(() => ({
  mockGetDataFrame: vi.fn(),
  mockGetDataTable: vi.fn(),
}));

vi.mock("@dashframe/core", () => ({
  getDataFrame: mockGetDataFrame,
  getDataTable: mockGetDataTable,
}));

const { mockBuildInsightSQL, mockEnsureTableLoaded } = vi.hoisted(() => ({
  mockBuildInsightSQL: vi.fn(),
  mockEnsureTableLoaded: vi.fn(),
}));

vi.mock("@dashframe/engine-browser", () => ({
  ensureTableLoaded: (...args: unknown[]) => mockEnsureTableLoaded(...args),
  buildInsightSQL: (...args: unknown[]) => mockBuildInsightSQL(...args),
  fieldIdToColumnAlias: (id: string) => `field_${id.replace(/-/g, "_")}`,
  metricIdToColumnAlias: (id: string) => `metric_${id.replace(/-/g, "_")}`,
}));

// engine exports used by the hook at import time
vi.mock("@dashframe/engine", () => ({
  buildInsightSQL: (...args: unknown[]) => mockBuildInsightSQL(...args),
  fieldIdToColumnAlias: (id: string) => `field_${id.replace(/-/g, "_")}`,
  metricIdToColumnAlias: (id: string) => `metric_${id.replace(/-/g, "_")}`,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInsight(id: string, tableId: string): Insight {
  return {
    id,
    name: `Insight ${id}`,
    baseTableId: tableId,
    selectedFields: [],
    metrics: [],
    createdAt: 0,
  };
}

function makeDataTable(id: string, dfId: string): DataTable {
  return {
    id,
    name: `Table ${id}`,
    dataSourceId: "ds-1",
    table: `tbl_${id}`,
    dataFrameId: dfId,
    fields: [],
    metrics: [],
    createdAt: 0,
  };
}

function makeDataFrame(id: string) {
  return {
    id,
    storage: { type: "indexeddb" as const, key: `df_${id}` },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useInsightPagination — stale-state guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockUseDuckDB.mockReturnValue({
      connection: mockConnection,
      isInitialized: true,
      isLoading: false,
    });

    mockEnsureTableLoaded.mockResolvedValue(undefined);
  });

  it("discards A's in-flight init when insight changes to B before A resolves", async () => {
    // Insight A's resolveTables (getDataTable) is artificially slow.
    // Insight B resolves instantly.
    // After B settles, releasing A must NOT overwrite totalCount or isReady.
    const tableA = makeDataTable("tbl-a", "df-a");
    const tableB = makeDataTable("tbl-b", "df-b");
    const dfA = makeDataFrame("df-a");
    const dfB = makeDataFrame("df-b");
    const insightA = makeInsight("ins-a", "tbl-a");
    const insightB = makeInsight("ins-b", "tbl-b");

    let resolveTableA!: (value: DataTable) => void;
    const slowTableAPromise = new Promise<DataTable>((res) => {
      resolveTableA = res;
    });

    mockGetDataTable.mockImplementation((id: string) => {
      if (id === "tbl-a") return slowTableAPromise;
      if (id === "tbl-b") return Promise.resolve(tableB);
      return Promise.resolve(null);
    });

    mockGetDataFrame.mockImplementation((id: string) => {
      if (id === "df-a") return Promise.resolve(dfA);
      if (id === "df-b") return Promise.resolve(dfB);
      return Promise.resolve(null);
    });

    // B's count SQL returns 42; A's would return 99 (should never be seen)
    mockBuildInsightSQL.mockImplementation(
      (_baseTable: DataTable, _joinedTables: unknown, insight: Insight) => {
        return insight.id === "ins-b"
          ? "SELECT 1 FROM tbl_b"
          : "SELECT 1 FROM tbl_a";
      },
    );

    mockConnection.query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("tbl_b")) {
        return Promise.resolve({
          toArray: () => [{ count: BigInt(42) }],
        });
      }
      // A's queries — should never reach here in the guarded scenario
      return Promise.resolve({
        toArray: () => [{ count: BigInt(99) }],
      });
    });

    const { result, rerender } = renderHook(
      ({ insight }: { insight: Insight }) => useInsightPagination({ insight }),
      { initialProps: { insight: insightA } },
    );

    // A's init is stuck at getDataTable("tbl-a"). Switch to B immediately.
    rerender({ insight: insightB });

    // Wait for B to settle fully.
    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.totalCount).toBe(42);

    // Now release A's slow getDataTable — A's continuation must be discarded.
    await act(async () => {
      resolveTableA(tableA);
    });

    // Give the event loop time to let A's continuation run if it weren't guarded.
    await new Promise((r) => setTimeout(r, 30));

    // B's state must be intact — A's stale result was discarded.
    expect(result.current.totalCount).toBe(42);
    expect(result.current.isReady).toBe(true);
  });
});
