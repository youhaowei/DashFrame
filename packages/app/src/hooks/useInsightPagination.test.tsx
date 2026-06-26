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
  buildInsightAvailableFields: (
    baseTable: DataTable,
    _joinedTables: unknown,
    _insight: unknown,
  ) => baseTable.fields ?? [],
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

    // Discriminate the built SQL on the BASE TABLE actually passed in (not the
    // insight id), so a fetchData that reads a corrupted resolvedTablesRef
    // (holding A's table) is detectable: it would build SQL against tbl_a.
    mockBuildInsightSQL.mockImplementation((baseTable: DataTable) => {
      return baseTable.id === "tbl-b"
        ? "SELECT 1 FROM tbl_b"
        : "SELECT 1 FROM tbl_a";
    });

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

    // Cache-corruption guard: A's released init must NOT have written its tables
    // into resolvedTablesRef (the cache write is now behind the gen check). A
    // subsequent fetchData reuses that cache, so it must build SQL against B's
    // table (tbl_b), never A's (tbl_a). Without the gen-guarded cache write, A's
    // resolveTables side-effect would have overwritten the ref and fetchData
    // would query tbl_a here.
    const queriedSqls: string[] = [];
    mockConnection.query = vi.fn().mockImplementation((sql: string) => {
      queriedSqls.push(sql);
      return Promise.resolve({ toArray: () => [] });
    });
    await act(async () => {
      await result.current.fetchData({ offset: 0, limit: 10 });
    });
    expect(queriedSqls.some((sql) => sql.includes("tbl_b"))).toBe(true);
    expect(queriedSqls.some((sql) => sql.includes("tbl_a"))).toBe(false);
  });

  it("discards an in-flight init when `enabled` flips false before it resolves", async () => {
    // Reachable path: VisualizationDisplay passes `enabled: !!insightForView`,
    // so a mounted component can flip enabled true→false while an init is in
    // flight (the insight clears). The skip branch must invalidate the
    // in-flight init's generation token so its stale count/readiness never land.
    const tableA = makeDataTable("tbl-a", "df-a");
    const dfA = makeDataFrame("df-a");
    const insightA = makeInsight("ins-a", "tbl-a");

    let resolveTableA!: (value: DataTable) => void;
    const slowTableAPromise = new Promise<DataTable>((res) => {
      resolveTableA = res;
    });

    mockGetDataTable.mockImplementation((id: string) =>
      id === "tbl-a" ? slowTableAPromise : Promise.resolve(null),
    );
    mockGetDataFrame.mockImplementation((id: string) =>
      id === "df-a" ? Promise.resolve(dfA) : Promise.resolve(null),
    );
    mockBuildInsightSQL.mockReturnValue("SELECT 1 FROM tbl_a");
    // If A's init were ever allowed to complete, it would set count=99 / ready.
    mockConnection.query = vi.fn().mockResolvedValue({
      toArray: () => [{ count: BigInt(99) }],
    });

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useInsightPagination({ insight: insightA, enabled }),
      { initialProps: { enabled: true } },
    );

    // A's init is stuck at getDataTable("tbl-a"). Disable the hook mid-flight.
    rerender({ enabled: false });

    // Release A's slow getDataTable — its continuation must be discarded
    // because the !enabled re-render bumped the generation token.
    await act(async () => {
      resolveTableA(tableA);
    });
    await new Promise((r) => setTimeout(r, 30));

    // The disabled hook must expose neither A's count nor a ready state.
    expect(result.current.totalCount).toBe(0);
    expect(result.current.isReady).toBe(false);
  });
});
