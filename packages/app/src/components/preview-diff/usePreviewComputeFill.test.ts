/**
 * Tests for usePreviewComputeFill.
 *
 * Contracts tested:
 * 1. Compute-fill: insight direct nodes receive rowCountBefore, rowCountAfter,
 *    and head from local DuckDB — the mocked compute helpers are called, the
 *    computed slots appear in the returned diff.
 * 2. Non-insight nodes and noop insight nodes never trigger compute.
 * 3. allResolved progresses correctly from false → true as nodes settle.
 * 4. A null diff is returned untouched (allResolved=true).
 * 5. Compute stays client-side: the mock seam is DuckDB, not an RPC call.
 */

import type {
  PreviewCompute,
  PreviewDiff,
  PreviewDirectNode,
} from "@dashframe/types";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergeComputeResult,
  usePreviewComputeFill,
} from "./usePreviewComputeFill";

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted so vi.mock can close over them
// ---------------------------------------------------------------------------

const { mockQuery, mockConnection, mockUseDuckDB } = vi.hoisted(() => {
  const query = vi.fn();
  return {
    mockQuery: query,
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
  buildInsightSQL: mockBuildInsightSQL,
  ensureTableLoaded: mockEnsureTableLoaded,
}));

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeDataTable(id: string, dataFrameId = `df-${id}`) {
  return {
    id,
    name: `Table ${id}`,
    dataSourceId: "ds-1",
    table: id,
    dataFrameId,
    fields: [],
    metrics: [],
    createdAt: 0,
  };
}

function makeDataFrame(id: string) {
  return {
    id,
    storage: { type: "indexeddb" as const, key: `arrow-${id}` },
    fieldIds: [],
    createdAt: 0,
  };
}

/** A minimal row-count result (DuckDB-style: bigint cnt). */
function makeCountResult(n: number) {
  return {
    toArray: () => [{ cnt: BigInt(n) }],
  };
}

/** A head result with `n` rows. */
function makeHeadResult(rows: Array<Record<string, unknown>>) {
  return {
    toArray: () => rows,
  };
}

/** Build a minimal `PreviewDirectNode` for an insight. */
function insightNode(
  nodeId: string,
  change: PreviewDirectNode["change"],
  opts: {
    baseTableId?: string;
    before?: Record<string, unknown> | null;
    proposedDefinition?: Record<string, unknown>;
  } = {},
): PreviewDirectNode {
  const baseTableId = opts.baseTableId ?? `table-${nodeId}`;
  const defaultBefore =
    change === "create"
      ? null
      : { baseTableId, selectedFields: [], metrics: [] };
  const before = opts.before !== undefined ? opts.before : defaultBefore;
  const proposedDefinition = opts.proposedDefinition ?? {
    baseTableId,
    selectedFields: [],
    metrics: [],
  };
  return {
    nodeId: nodeId as PreviewDirectNode["nodeId"],
    kind: "insight",
    name: `Insight ${nodeId}`,
    change,
    intent: [],
    before,
    proposedDefinition,
  };
}

/** Build a `PreviewDirectNode` for a non-insight kind. */
function nonInsightNode(
  nodeId: string,
  kind: PreviewDirectNode["kind"] = "dataTable",
): PreviewDirectNode {
  return {
    nodeId: nodeId as PreviewDirectNode["nodeId"],
    kind,
    name: `Node ${nodeId}`,
    change: "update",
    intent: [],
    before: { name: "test" },
    proposedDefinition: { name: "test-v2" },
  };
}

/** Build a minimal `PreviewDiff`. */
function makeDiff(directNodes: PreviewDirectNode[]): PreviewDiff {
  return {
    mode: "preview",
    directNodes,
    affectedDownstream: [],
    tablesWritten: [],
  };
}

// ---------------------------------------------------------------------------
// Default DuckDB mock — DuckDB ready, query returns generic results.
// Individual tests override as needed.
// ---------------------------------------------------------------------------

function setupReadyDuckDB() {
  mockUseDuckDB.mockReturnValue({
    connection: mockConnection,
    isInitialized: true,
    db: {},
    error: null,
  });
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  setupReadyDuckDB();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePreviewComputeFill", () => {
  describe("null diff passthrough", () => {
    it("returns null diff + allResolved=true immediately", () => {
      const { result } = renderHook(() => usePreviewComputeFill(null));
      expect(result.current.diff).toBeNull();
      expect(result.current.allResolved).toBe(true);
    });
  });

  describe("insight node compute fill", () => {
    it("fills compute slot on a single update insight node", async () => {
      const tableId = "table-fill";
      const table = makeDataTable(tableId);
      const frame = makeDataFrame(`df-${tableId}`);

      mockGetDataTable.mockResolvedValue(table);
      mockGetDataFrame.mockResolvedValue(frame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM fill_test");

      // Promise.all order: rowCountAfter, head, rowCountBefore
      mockQuery
        .mockResolvedValueOnce(makeCountResult(42))
        .mockResolvedValueOnce(makeHeadResult([{ x: "hello" }, { x: "world" }]))
        .mockResolvedValueOnce(makeCountResult(30));

      const node = insightNode("n1", "update", { baseTableId: tableId });
      const diff = makeDiff([node]);

      const { result } = renderHook(() => usePreviewComputeFill(diff));

      // Immediately after mount: diff is returned without compute (still undefined).
      expect(result.current.diff?.directNodes[0].compute).toBeUndefined();

      // Wait for the async fill to complete.
      await waitFor(() => {
        expect(result.current.allResolved).toBe(true);
      });

      const compute = result.current.diff?.directNodes[0]
        .compute as PreviewCompute;
      expect(compute).toBeDefined();
      expect(compute.rowCountAfter).toBe(42);
      expect(compute.rowCountBefore).toBe(30);
      expect(compute.head).toEqual([{ x: "hello" }, { x: "world" }]);
    });

    it("fills compute slot on a create insight node (no before → rowCountBefore=null)", async () => {
      const tableId = "table-create";
      const table = makeDataTable(tableId);
      const frame = makeDataFrame(`df-${tableId}`);

      mockGetDataTable.mockResolvedValue(table);
      mockGetDataFrame.mockResolvedValue(frame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT 1 AS col");

      // For a create node: before=null → canonical insight is null → rowCountBefore stays null.
      // Promise.all: rowCountAfter, head, rowCountBefore(never awaited for canonical=null)
      // The hook calls `canonical ? computeRowCount(canonical, conn) : Promise.resolve(null)`.
      mockQuery
        .mockResolvedValueOnce(makeCountResult(5)) // rowCountAfter
        .mockResolvedValueOnce(makeHeadResult([{ col: 1 }])); // head

      const node = insightNode("n-create", "create", { baseTableId: tableId });
      const diff = makeDiff([node]);

      const { result } = renderHook(() => usePreviewComputeFill(diff));

      await waitFor(() => {
        expect(result.current.allResolved).toBe(true);
      });

      const compute = result.current.diff?.directNodes[0]
        .compute as PreviewCompute;
      expect(compute.rowCountBefore).toBeNull();
      expect(compute.rowCountAfter).toBe(5);
      expect(compute.head).toEqual([{ col: 1 }]);
    });
  });

  describe("noop insight node — no compute", () => {
    it("does not trigger compute for a noop insight node", async () => {
      const node = insightNode("n-noop", "noop");
      const diff = makeDiff([node]);

      const { result } = renderHook(() => usePreviewComputeFill(diff));

      // allResolved is true immediately — noop is not computable.
      expect(result.current.allResolved).toBe(true);
      // compute slot stays undefined.
      expect(result.current.diff?.directNodes[0].compute).toBeUndefined();
      // No DuckDB queries fired.
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("non-insight node — no compute", () => {
    it("does not trigger compute for dataTable, dataSource, etc. nodes", async () => {
      const diff = makeDiff([
        nonInsightNode("nt1", "dataTable"),
        nonInsightNode("nt2", "dataSource"),
      ]);

      const { result } = renderHook(() => usePreviewComputeFill(diff));

      expect(result.current.allResolved).toBe(true);
      expect(result.current.diff?.directNodes[0].compute).toBeUndefined();
      expect(result.current.diff?.directNodes[1].compute).toBeUndefined();
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("mixed node types", () => {
    it("fills insight nodes and leaves non-insight nodes untouched", async () => {
      const tableId = "table-mixed";
      const table = makeDataTable(tableId);
      const frame = makeDataFrame(`df-${tableId}`);

      mockGetDataTable.mockResolvedValue(table);
      mockGetDataFrame.mockResolvedValue(frame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM mixed");

      mockQuery
        .mockResolvedValueOnce(makeCountResult(7))
        .mockResolvedValueOnce(makeHeadResult([{ v: "r1" }]))
        .mockResolvedValueOnce(makeCountResult(5));

      const diff = makeDiff([
        nonInsightNode("dt1", "dataTable"),
        insightNode("ins1", "update", { baseTableId: tableId }),
        nonInsightNode("ds1", "dataSource"),
      ]);

      const { result } = renderHook(() => usePreviewComputeFill(diff));

      await waitFor(() => {
        expect(result.current.allResolved).toBe(true);
      });

      // Non-insight nodes: untouched.
      expect(result.current.diff?.directNodes[0].compute).toBeUndefined();
      expect(result.current.diff?.directNodes[2].compute).toBeUndefined();

      // Insight node: filled.
      const compute = result.current.diff?.directNodes[1]
        .compute as PreviewCompute;
      expect(compute.rowCountAfter).toBe(7);
      expect(compute.rowCountBefore).toBe(5);
      expect(compute.head).toEqual([{ v: "r1" }]);
    });
  });

  describe("renders before compute completes (progressive fill)", () => {
    it("returns the diff immediately with compute undefined, then fills progressively", async () => {
      const tableId = "table-prog";
      const table = makeDataTable(tableId);
      const frame = makeDataFrame(`df-${tableId}`);

      mockGetDataTable.mockResolvedValue(table);
      mockGetDataFrame.mockResolvedValue(frame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM prog");

      // Collect all resolvers so we can unblock all pending queries at once.
      const resolvers: Array<() => void> = [];
      mockQuery.mockImplementation(
        () =>
          new Promise<ReturnType<typeof makeCountResult>>((resolve) => {
            resolvers.push(() => resolve(makeCountResult(3)));
          }),
      );

      const node = insightNode("n-prog", "update", { baseTableId: tableId });
      const diff = makeDiff([node]);

      const { result } = renderHook(() => usePreviewComputeFill(diff));

      // Immediately: diff exists but compute is not yet filled.
      expect(result.current.diff).not.toBeNull();
      expect(result.current.diff?.directNodes[0].compute).toBeUndefined();
      // allResolved is false because a computable node is pending.
      expect(result.current.allResolved).toBe(false);

      // Unblock all pending queries (the Promise.all fires 3 in parallel).
      await waitFor(() => expect(resolvers.length).toBeGreaterThan(0));
      resolvers.forEach((r) => r());

      await waitFor(() => {
        expect(result.current.allResolved).toBe(true);
      });

      expect(result.current.diff?.directNodes[0].compute).toBeDefined();
    });
  });

  describe("DuckDB not ready", () => {
    it("does not kick off compute when DuckDB is not initialized", () => {
      mockUseDuckDB.mockReturnValue({
        connection: null,
        isInitialized: false,
        db: null,
        error: null,
      });

      const node = insightNode("n-notready", "update");
      const diff = makeDiff([node]);

      const { result } = renderHook(() => usePreviewComputeFill(diff));

      // No compute fires — allResolved stays false (the node is computable but
      // hasn't been computed yet because DuckDB isn't ready).
      expect(result.current.diff?.directNodes[0].compute).toBeUndefined();
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("missing base table — graceful non-fatal", () => {
    it("keeps compute undefined (non-fatal) when base table is missing", async () => {
      mockGetDataTable.mockResolvedValue(null);

      const node = insightNode("n-notable", "update", {
        baseTableId: "table-missing",
      });
      const diff = makeDiff([node]);

      const { result } = renderHook(() => usePreviewComputeFill(diff));

      // The node is marked computable then kicks off — but ensureInsightDataFrames
      // returns null, so the compute resolves to a null rowCountAfter and empty head.
      // The slot is still filled (with nulls).
      await waitFor(() => {
        expect(result.current.allResolved).toBe(true);
      });

      const compute = result.current.diff?.directNodes[0].compute;
      // Still filled — graceful path: null counts + empty head.
      expect(compute).toBeDefined();
      expect(compute?.rowCountAfter).toBeNull();
      expect(compute?.head).toEqual([]);
    });
  });

  describe("buildInsightSQL returns null — graceful non-fatal", () => {
    it("fills slot with null counts when SQL can't be generated", async () => {
      const tableId = "table-nosql";
      const table = makeDataTable(tableId);
      const frame = makeDataFrame(`df-${tableId}`);

      mockGetDataTable.mockResolvedValue(table);
      mockGetDataFrame.mockResolvedValue(frame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      // SQL build returns null — unsupported insight config.
      mockBuildInsightSQL.mockReturnValue(null);

      const node = insightNode("n-nosql", "update", { baseTableId: tableId });
      const diff = makeDiff([node]);

      const { result } = renderHook(() => usePreviewComputeFill(diff));

      await waitFor(() => {
        expect(result.current.allResolved).toBe(true);
      });

      const compute = result.current.diff?.directNodes[0].compute;
      expect(compute).toBeDefined();
      expect(compute?.rowCountAfter).toBeNull();
      expect(compute?.head).toEqual([]);
    });
  });

  describe("diff identity change — reset", () => {
    it("resets compute when a new diff is passed", async () => {
      const tableId = "table-reset";
      const table = makeDataTable(tableId);
      const frame = makeDataFrame(`df-${tableId}`);

      mockGetDataTable.mockResolvedValue(table);
      mockGetDataFrame.mockResolvedValue(frame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT 1");

      mockQuery
        .mockResolvedValueOnce(makeCountResult(10))
        .mockResolvedValueOnce(makeHeadResult([{ x: 1 }]))
        .mockResolvedValueOnce(makeCountResult(8));

      const node1 = insightNode("n-r1", "update", { baseTableId: tableId });
      const diff1 = makeDiff([node1]);

      const { result, rerender } = renderHook(
        ({ diff }: { diff: PreviewDiff }) => usePreviewComputeFill(diff),
        { initialProps: { diff: diff1 } },
      );

      await waitFor(() => {
        expect(result.current.allResolved).toBe(true);
      });

      // First diff: compute is filled.
      expect(result.current.diff?.directNodes[0].compute).toBeDefined();

      // Swap in a new diff (different object identity).
      const node2 = insightNode("n-r2", "update", { baseTableId: tableId });
      const diff2 = makeDiff([node2]);

      // Reset queries for the second diff.
      mockQuery
        .mockResolvedValueOnce(makeCountResult(20))
        .mockResolvedValueOnce(makeHeadResult([{ y: 2 }]))
        .mockResolvedValueOnce(makeCountResult(15));

      rerender({ diff: diff2 });

      await waitFor(() => {
        // The NEW node's compute is filled.
        expect(result.current.diff?.directNodes[0].nodeId).toBe("n-r2");
        expect(result.current.diff?.directNodes[0].compute).toBeDefined();
        expect(result.current.diff?.directNodes[0].compute?.rowCountAfter).toBe(
          20,
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // FIX 1 — fold command args onto the canonical stored definition.
  //
  // `before` is the RAW insights row: config lives under `before.definition`.
  // `proposedDefinition` carries RAW COMMAND ARGS with DIFFERENT key names
  // (`fieldIds` not `selectedFields`). The proposed InsightLike handed to
  // buildInsightSQL must reflect the PROPOSED query, not the stale one — else
  // the after-count is wrong and the node looks stuck.
  // -------------------------------------------------------------------------
  describe("FIX 1 — proposed shape folds command args onto before.definition", () => {
    it("maps proposedDefinition.fieldIds → selectedFields over the canonical base", async () => {
      const tableId = "table-fold";
      const table = makeDataTable(tableId);
      const frame = makeDataFrame(`df-${tableId}`);

      mockGetDataTable.mockResolvedValue(table);
      mockGetDataFrame.mockResolvedValue(frame);
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM fold");
      mockQuery.mockResolvedValue(makeCountResult(1));

      // Canonical before: a RAW insights row — config nested under .definition.
      const node: PreviewDirectNode = {
        nodeId: "n-fold" as PreviewDirectNode["nodeId"],
        kind: "insight",
        name: "Insight fold",
        change: "update",
        intent: [],
        before: {
          id: "n-fold",
          name: "Insight fold",
          definition: {
            baseTableId: tableId,
            selectedFields: ["fld-a"],
            metrics: [],
          },
        },
        // Proposed change: SelectFields replace-all with [a, b] under `fieldIds`.
        proposedDefinition: { fieldIds: ["fld-a", "fld-b"] },
      };
      const diff = makeDiff([node]);

      renderHook(() => usePreviewComputeFill(diff));

      await waitFor(() => {
        expect(mockBuildInsightSQL).toHaveBeenCalled();
      });

      // Find the call whose insight has TWO selected fields — the PROPOSED shape.
      const proposedCall = mockBuildInsightSQL.mock.calls.find(
        (c) =>
          (c[2] as { selectedFields: string[] }).selectedFields.length === 2,
      );
      expect(proposedCall).toBeDefined();
      const proposedInsight = proposedCall![2] as {
        baseTableId: string;
        selectedFields: string[];
      };
      // Folded: selectedFields is the PROPOSED [a, b], not the stale [a].
      expect(proposedInsight.selectedFields).toEqual(["fld-a", "fld-b"]);
      // baseTableId comes from the canonical definition (not lost in the fold).
      expect(proposedInsight.baseTableId).toBe(tableId);
    });

    it("maps proposedDefinition.source.sourceId → baseTableId (SetInsightSource)", async () => {
      const oldTable = "table-old";
      const newTable = "table-new";
      mockGetDataTable.mockImplementation(async (id: string) =>
        makeDataTable(id),
      );
      mockGetDataFrame.mockImplementation(async (id: string) =>
        makeDataFrame(id),
      );
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM src");
      mockQuery.mockResolvedValue(makeCountResult(1));

      const node: PreviewDirectNode = {
        nodeId: "n-src" as PreviewDirectNode["nodeId"],
        kind: "insight",
        name: "Insight src",
        change: "update",
        intent: [],
        before: {
          definition: {
            baseTableId: oldTable,
            selectedFields: [],
            metrics: [],
          },
        },
        // SetInsightSource args: { source: { sourceType, sourceId } }.
        proposedDefinition: {
          source: { sourceType: "dataTable", sourceId: newTable },
        },
      };
      const diff = makeDiff([node]);

      renderHook(() => usePreviewComputeFill(diff));

      await waitFor(() => expect(mockBuildInsightSQL).toHaveBeenCalled());

      // The proposed shape must point at the NEW base table.
      const proposedCall = mockBuildInsightSQL.mock.calls.find(
        (c) => (c[2] as { baseTableId: string }).baseTableId === newTable,
      );
      expect(proposedCall).toBeDefined();
    });

    it("fails honest (no compute) on an un-foldable incremental edit (AddMetric)", async () => {
      const tableId = "table-incr";
      mockGetDataTable.mockResolvedValue(makeDataTable(tableId));
      mockGetDataFrame.mockResolvedValue(makeDataFrame(`df-${tableId}`));
      mockEnsureTableLoaded.mockResolvedValue(undefined);
      mockBuildInsightSQL.mockReturnValue("SELECT * FROM incr");
      mockQuery.mockResolvedValue(makeCountResult(7));

      const node: PreviewDirectNode = {
        nodeId: "n-incr" as PreviewDirectNode["nodeId"],
        kind: "insight",
        name: "Insight incr",
        change: "update",
        intent: [],
        before: {
          definition: { baseTableId: tableId, selectedFields: [], metrics: [] },
        },
        // AddMetric args carry a single `metric` element — un-foldable post-hoc.
        proposedDefinition: { metric: { id: "m1", aggregation: "count" } },
      };
      const diff = makeDiff([node]);

      const { result } = renderHook(() => usePreviewComputeFill(diff));

      // The node resolves to the empty sentinel (unavailable), NOT a stale count:
      // buildInsightSQL is never invoked for the proposed shape, and the node's
      // compute slot is the null sentinel rather than a stuck-undefined spinner.
      await waitFor(() => expect(result.current.allResolved).toBe(true));
      expect(mockBuildInsightSQL).not.toHaveBeenCalled();
      const filled = result.current.diff?.directNodes.find(
        (n) => n.nodeId === "n-incr",
      );
      expect(filled?.compute).toEqual({
        rowCountBefore: null,
        rowCountAfter: null,
        head: [],
      });
    });
  });

  // -------------------------------------------------------------------------
  // FIX 2 — stale-guard reducer. A late result for a superseded diff (A) must
  // NOT clobber the current diff (B). Tested at the pure-reducer seam rather
  // than through a DuckDB mock-thicket.
  // -------------------------------------------------------------------------
  describe("FIX 2 — mergeComputeResult stale guard", () => {
    const diffA = makeDiff([insightNode("a1", "update")]);
    const diffB = makeDiff([insightNode("b1", "update")]);
    const compute: PreviewCompute = {
      rowCountBefore: 1,
      rowCountAfter: 2,
      head: [],
    };

    it("merges a result whose diff is the current diff", () => {
      const prev = { diff: diffA, computeByNodeId: new Map() };
      // forDiff === currentDiff === prev.diff → normal progressive merge.
      const next = mergeComputeResult(prev, diffA, diffA, "a1", compute);
      expect(next.computeByNodeId.get("a1")).toBe(compute);
      expect(next.diff).toBe(diffA);
    });

    it("resets to a fresh map on the first result of a freshly-active diff", () => {
      // State still holds diffA's entries, but the live diff is now diffB.
      const stateA = {
        diff: diffA,
        computeByNodeId: new Map<string, PreviewCompute>([["a1", compute]]),
      };
      // B's first result arrives; forDiff === currentDiff === diffB.
      const next = mergeComputeResult(stateA, diffB, diffB, "b1", compute);
      expect(next.diff).toBe(diffB);
      // Stale A entry dropped; only B's node present.
      expect(next.computeByNodeId.has("a1")).toBe(false);
      expect(next.computeByNodeId.get("b1")).toBe(compute);
    });

    it("drops a late A-result after the live diff has moved on to B (A→B race)", () => {
      // State has already advanced to diff B (user opened B).
      const stateB = {
        diff: diffB,
        computeByNodeId: new Map<string, PreviewCompute>([["b1", compute]]),
      };
      // A's async work resolves LAST: forDiff=A but the live diff is now B.
      const next = mergeComputeResult(stateB, diffA, diffB, "a1", compute);
      // B's state is intact and untouched — no A node leaked in, identity kept.
      expect(next).toBe(stateB);
      expect(next.diff).toBe(diffB);
      expect(next.computeByNodeId.has("a1")).toBe(false);
      expect(next.computeByNodeId.get("b1")).toBe(compute);
    });

    it("never writes the stale diff's identity back onto current state", () => {
      const stateB = { diff: diffB, computeByNodeId: new Map() };
      const next = mergeComputeResult(stateB, diffA, diffB, "a1", compute);
      // The classic bug: writing { diff: A, ... } back clobbers B. Guard holds.
      expect(next.diff).not.toBe(diffA);
      expect(next.diff).toBe(diffB);
    });
  });
});
