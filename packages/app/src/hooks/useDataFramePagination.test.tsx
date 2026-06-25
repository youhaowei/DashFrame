/**
 * Unit tests for useDataFramePagination hook — empty-result column reset
 *
 * Contract: when a resolved result has zero rows, columns must be reset to []
 * rather than left at the prior DataFrame's column set.
 *
 * This guards against the regression where `if (rows.length > 0)` skipped
 * setColumns on the zero-row path, leaving stale schema visible for an empty
 * table.
 *
 * The generation-guard invariant (stale-async-state fix) must NOT be
 * regressed: the reset fires only inside the current generation's resolved
 * continuation (after the gen check at the preview step), never from a
 * superseded in-flight init.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDataFramePagination } from "./useDataFramePagination";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockUseDuckDB, mockGetDataFrame, mockUseDataFrames } = vi.hoisted(
  () => ({
    mockUseDuckDB: vi.fn(),
    mockGetDataFrame: vi.fn(),
    mockUseDataFrames: vi.fn(),
  }),
);

vi.mock("@/components/providers/DuckDBProvider", () => ({
  useDuckDB: () => mockUseDuckDB(),
}));

vi.mock("@dashframe/core", () => ({
  getDataFrame: (...args: unknown[]) => mockGetDataFrame(...args),
  useDataFrames: () => mockUseDataFrames(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock queryBuilder that produces the given preview rows. */
function makeQueryBuilder(previewRows: Record<string, unknown>[]) {
  const queryBuilder = {
    sql: vi.fn().mockResolvedValue("SELECT 1"),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };

  const dataFrame = {
    id: "df-test",
    load: vi.fn().mockResolvedValue(queryBuilder),
  };

  return { dataFrame };
}

const READY_DDB = {
  isInitialized: true,
  isLoading: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useDataFramePagination — empty-result column reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockUseDataFrames.mockReturnValue({ data: [] });
  });

  it("resets columns to [] when the current generation returns zero preview rows (was: stale prior columns stay visible)", async () => {
    // Phase 1: render DataFrame A — preview returns 1 row with columns col_a, col_b.
    // Phase 2: switch to DataFrame B — preview returns 0 rows.
    // Expected: columns = [] after B settles.
    // Pre-fix: columns = [{name:'col_a'}, {name:'col_b'}] — stale schema bug.

    const { dataFrame: dfA } = makeQueryBuilder([{ col_a: "v1", col_b: "v2" }]);
    const { dataFrame: dfB } = makeQueryBuilder([]);

    // Single shared connection whose .query is swapped between phases.
    const connection = {
      query: vi
        .fn()
        // A — count
        .mockResolvedValueOnce({ toArray: () => [{ count: BigInt(1) }] })
        // A — preview (1 row with two columns)
        .mockResolvedValueOnce({
          toArray: () => [{ col_a: "v1", col_b: "v2" }],
        }),
    };

    mockUseDuckDB.mockReturnValue({ ...READY_DDB, connection });
    mockUseDataFrames.mockReturnValue({
      data: [{ id: "df-a" }, { id: "df-b" }],
    });
    mockGetDataFrame.mockImplementation((id: string) => {
      if (id === "df-a") return Promise.resolve(dfA);
      if (id === "df-b") return Promise.resolve(dfB);
      return Promise.resolve(null);
    });

    const { result, rerender } = renderHook(
      ({ dataFrameId }: { dataFrameId: string }) =>
        useDataFramePagination(
          dataFrameId as `${string}-${string}-${string}-${string}-${string}`,
        ),
      { initialProps: { dataFrameId: "df-a" } },
    );

    // Wait for A to settle — columns must be non-empty (non-triviality baseline).
    await waitFor(() => {
      expect(result.current.columns.length).toBeGreaterThan(0);
    });
    expect(result.current.columns.map((c) => c.name)).toEqual([
      "col_a",
      "col_b",
    ]);

    // Phase 2: swap query to return count=0, preview=[] for DataFrame B.
    connection.query = vi
      .fn()
      // B — count
      .mockResolvedValueOnce({ toArray: () => [{ count: BigInt(0) }] })
      // B — preview (empty result)
      .mockResolvedValueOnce({ toArray: () => [] });

    // Rerender to B — triggers a new init in the hook.
    rerender({ dataFrameId: "df-b" });

    // Wait for B's totalCount to settle (observable without depending on isReady timing).
    await waitFor(() => {
      expect(result.current.totalCount).toBe(0);
    });

    // Critical assertion: columns must be [] for the zero-row result.
    // waitFor polls until the rAF that calls setColumns([]) has landed.
    await waitFor(() => {
      expect(result.current.columns).toEqual([]);
    });
  });
});
