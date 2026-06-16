/**
 * usePreviewComputeFill — fills the `compute` slot on insight direct nodes.
 *
 * SPLIT-TIER (settled): the server always emits `compute: undefined` on every
 * PreviewDirectNode. This hook fills each node's slot lazily on preview-open,
 * computing rowCountBefore / rowCountAfter / head entirely via local DuckDB
 * (WASM). No row data ever rides the WyStack RPC.
 *
 * Open-Q#6 resolution: we re-compile (buildInsightSQL) and re-execute for each
 * node. This reuses the EXACT same compile→execute path as the live insight
 * view (useInsightView → buildInsightSQL → conn.query). Re-execute-only would
 * require a pre-existing view for the proposed definition, which doesn't exist
 * for preview (the transaction rolled back). Re-compile+execute is clean and
 * correct: no parallel compute path, no forked SQL generation.
 *
 * Scope: only `kind === 'insight'` nodes compute rowCount + head. Other kinds
 * (dataTable, dataSource, etc.) don't have a queryable SQL view in DuckDB, so
 * their compute slot stays `undefined`.
 */

import { useDuckDB } from "@/components/providers/DuckDBProvider";
import { getDataFrame, getDataTable } from "@dashframe/core";
import { buildInsightSQL, ensureTableLoaded } from "@dashframe/engine-browser";
import type {
  DataTable,
  Insight,
  PreviewCompute,
  PreviewDiff,
  PreviewDirectNode,
  UUID,
} from "@dashframe/types";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Helpers to coerce proposedDefinition / before into a partial Insight shape
// ---------------------------------------------------------------------------

type InsightLike = Pick<
  Insight,
  | "id"
  | "baseTableId"
  | "selectedFields"
  | "metrics"
  | "joins"
  | "filters"
  | "sorts"
>;

/**
 * Coerce a raw `Record<string, unknown>` (proposedDefinition or before slice)
 * to a partial insight shape. Unknown/missing fields fall back to safe defaults.
 */
function coerceToInsightLike(
  raw: Record<string, unknown>,
  nodeId: UUID,
): InsightLike {
  // source.sourceId is the canonical field for insight-on-insight composition.
  const sourceRecord = raw.source as Record<string, unknown> | undefined;
  const sourceId =
    typeof sourceRecord?.sourceId === "string"
      ? (sourceRecord.sourceId as UUID)
      : undefined;
  const baseTableId =
    typeof raw.baseTableId === "string" ? (raw.baseTableId as UUID) : sourceId;

  return {
    id: nodeId,
    baseTableId: (baseTableId ?? "") as UUID,
    selectedFields: Array.isArray(raw.selectedFields)
      ? (raw.selectedFields as UUID[])
      : [],
    metrics: Array.isArray(raw.metrics)
      ? (raw.metrics as Insight["metrics"])
      : [],
    joins: Array.isArray(raw.joins)
      ? (raw.joins as Insight["joins"])
      : undefined,
    filters: Array.isArray(raw.filters)
      ? (raw.filters as Insight["filters"])
      : undefined,
    sorts: Array.isArray(raw.sorts)
      ? (raw.sorts as Insight["sorts"])
      : undefined,
  };
}

/**
 * Merge `before` (canonical) with `proposedDefinition` (the proposed change)
 * to produce the PROPOSED insight config that would take effect after the batch
 * commits. The merge mirrors how `foldCommand` in the server builder accumulates
 * command args: later args override earlier ones (Object.assign semantics).
 */
function buildProposedInsight(node: PreviewDirectNode): InsightLike | null {
  if (node.kind !== "insight") return null;

  // Merge: start from the canonical before slice, overlay proposedDefinition.
  // For a `create` node there is no before slice — use proposedDefinition only.
  const base: Record<string, unknown> =
    node.before !== null
      ? { ...node.before, ...node.proposedDefinition }
      : { ...node.proposedDefinition };

  const result = coerceToInsightLike(base, node.nodeId);
  if (!result.baseTableId) return null;
  return result;
}

/**
 * Build a canonical (pre-batch) insight shape for rowCountBefore.
 * Uses the `before` slice only — the state BEFORE the batch would apply.
 */
function buildCanonicalInsight(node: PreviewDirectNode): InsightLike | null {
  if (node.kind !== "insight" || node.before === null) return null;
  const result = coerceToInsightLike(node.before, node.nodeId);
  if (!result.baseTableId) return null;
  return result;
}

// ---------------------------------------------------------------------------
// DuckDB query helpers
// ---------------------------------------------------------------------------

/**
 * Ensure all DataFrames for an insight are loaded in DuckDB.
 * Returns the Map of rightTableId → DataTable needed by buildInsightSQL.
 */
async function ensureInsightDataFrames(
  insightLike: InsightLike,
  conn: import("@duckdb/duckdb-wasm").AsyncDuckDBConnection,
): Promise<{
  baseTable: DataTable;
  joinedTables: Map<UUID, DataTable>;
} | null> {
  const baseTable = await getDataTable(insightLike.baseTableId);
  if (!baseTable?.dataFrameId) return null;

  const baseDF = await getDataFrame(baseTable.dataFrameId);
  if (!baseDF) return null;

  await ensureTableLoaded(baseDF, conn);

  const joinedTables = new Map<UUID, DataTable>();
  const joins = insightLike.joins ?? [];
  await Promise.all(
    joins.map(async (join) => {
      const joinTable = await getDataTable(join.rightTableId);
      if (!joinTable?.dataFrameId) return;
      const joinDF = await getDataFrame(joinTable.dataFrameId);
      if (!joinDF) return;
      await ensureTableLoaded(joinDF, conn);
      joinedTables.set(join.rightTableId, joinTable);
    }),
  );

  return { baseTable, joinedTables };
}

/**
 * Compute the row count for a given insight config against local DuckDB.
 * Returns `null` if the data isn't available or SQL can't be generated.
 */
async function computeRowCount(
  insightLike: InsightLike,
  conn: import("@duckdb/duckdb-wasm").AsyncDuckDBConnection,
): Promise<number | null> {
  const tables = await ensureInsightDataFrames(insightLike, conn);
  if (!tables) return null;

  const { baseTable, joinedTables } = tables;

  // Use "query" mode — that gives the aggregated result set (matching what the
  // insight would actually produce). Fall back to "model" if no selectedFields/metrics.
  const hasAggregation =
    insightLike.selectedFields.length > 0 ||
    (insightLike.metrics?.length ?? 0) > 0;
  const mode = hasAggregation ? "query" : "model";

  // Treat insightLike as a minimal Insight for SQL generation.
  const sql = buildInsightSQL(
    baseTable,
    joinedTables,
    insightLike as unknown as Insight,
    { mode },
  );
  if (!sql) return null;

  try {
    const result = await conn.query(`SELECT COUNT(*) AS cnt FROM (${sql})`);
    const rows = result.toArray();
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return 0;
    const cnt = row.cnt;
    if (typeof cnt === "bigint") return Number(cnt);
    if (typeof cnt === "number") return cnt;
    return null;
  } catch {
    return null;
  }
}

/** HEAD_N is the number of sample rows to return in the `head` slot. */
const HEAD_N = 5;

/**
 * Compute the head rows (first N rows) for a given insight config.
 * Returns an empty array if the data isn't available or SQL can't be generated.
 */
async function computeHead(
  insightLike: InsightLike,
  conn: import("@duckdb/duckdb-wasm").AsyncDuckDBConnection,
): Promise<Array<Record<string, unknown>>> {
  const tables = await ensureInsightDataFrames(insightLike, conn);
  if (!tables) return [];

  const { baseTable, joinedTables } = tables;

  const hasAggregation =
    insightLike.selectedFields.length > 0 ||
    (insightLike.metrics?.length ?? 0) > 0;
  const mode = hasAggregation ? "query" : "model";

  const sql = buildInsightSQL(
    baseTable,
    joinedTables,
    insightLike as unknown as Insight,
    { mode, limit: HEAD_N },
  );
  if (!sql) return [];

  try {
    const result = await conn.query(sql);
    return result
      .toArray()
      .map((row) => ({ ...(row as Record<string, unknown>) }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * A diff with per-node compute slots that may be progressively filled.
 * Each node's `compute` is either `undefined` (pending/unsupported) or a
 * `PreviewCompute` once its data is resolved from local DuckDB.
 */
export interface DiffWithCompute {
  /** The original diff with compute slots filled in-place as they resolve. */
  diff: PreviewDiff;
  /** Whether ALL computable nodes have resolved their compute slots. */
  allResolved: boolean;
}

/**
 * Fill the `compute` slot on each insight direct node progressively.
 *
 * - Returns immediately with the original diff (renders before compute).
 * - Each node resolves independently; state updates per resolved node.
 * - Non-insight kinds never get a compute slot (stays `undefined`).
 * - If DuckDB is not yet ready, waits until it initialises.
 *
 * Privacy: all computation is client-side. No row data leaves the renderer.
 */
export function usePreviewComputeFill(diff: PreviewDiff | null): {
  diff: PreviewDiff | null;
  allResolved: boolean;
} {
  const { connection, isInitialized } = useDuckDB();

  // Store per-node compute results alongside the diff they belong to.
  // Coupling them in one state object means a diff change atomically resets
  // the map via the functional updater (in async callbacks, not in the effect
  // body), keeping cascading render cycles to a minimum.
  const [state, setState] = useState<{
    diff: PreviewDiff | null;
    computeByNodeId: Map<string, PreviewCompute>;
  }>({ diff, computeByNodeId: new Map() });

  // Derive the active compute map: if the stored diff has diverged from the
  // current diff (new preview opened), treat the map as empty until the async
  // fills for the new diff start arriving.
  const computeByNodeId =
    state.diff === diff
      ? state.computeByNodeId
      : new Map<string, PreviewCompute>();

  // Kick off compute for each insight node when DuckDB is ready.
  useEffect(() => {
    if (!diff || !connection || !isInitialized) return;

    const conn = connection;
    const thisDiff = diff;

    for (const node of diff.directNodes) {
      // Only insight nodes get compute; skip if already resolved.
      if (node.kind !== "insight") continue;
      // noop nodes don't change — no compute needed.
      if (node.change === "noop") continue;

      const proposed = buildProposedInsight(node);
      if (!proposed) continue;

      // Skip nodes already resolved for this exact diff.
      if (state.diff === diff && state.computeByNodeId.has(node.nodeId))
        continue;

      const canonical = buildCanonicalInsight(node);

      // Fire-and-forget: each node resolves independently.
      const nodeId = node.nodeId;
      (async () => {
        const computeResult: PreviewCompute = await (async () => {
          try {
            // Compute proposed counts + head in parallel with canonical count.
            const [rowCountAfter, head, rowCountBefore] = await Promise.all([
              computeRowCount(proposed, conn),
              computeHead(proposed, conn),
              canonical
                ? computeRowCount(canonical, conn)
                : Promise.resolve(null),
            ]);
            return { rowCountBefore, rowCountAfter, head };
          } catch {
            // Non-fatal: sentinel with nulls so allResolved stops waiting.
            return { rowCountBefore: null, rowCountAfter: null, head: [] };
          }
        })();

        // Functional update: merges into the state for the correct diff and
        // resets implicitly if a stale diff's update arrives after a swap.
        setState((prev) => {
          const prevMap =
            prev.diff === thisDiff
              ? prev.computeByNodeId
              : new Map<string, PreviewCompute>();
          const next = new Map(prevMap);
          next.set(nodeId, computeResult);
          return { diff: thisDiff, computeByNodeId: next };
        });
      })();
    }
    // state intentionally excluded from deps: including it would re-run on each
    // partial fill, causing duplicate compute kicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff, connection, isInitialized]);

  if (!diff) return { diff: null, allResolved: true };

  // Derive computable node ids directly from the diff (pure render logic, no ref).
  // A node is computable when: insight kind, non-noop change, has a valid baseTableId.
  const computableIds = diff.directNodes
    .filter(
      (n) =>
        n.kind === "insight" &&
        n.change !== "noop" &&
        buildProposedInsight(n) !== null,
    )
    .map((n) => n.nodeId);

  // Build the filled diff — shallow-clone only; mutate compute slots on a per-
  // node basis rather than cloning the entire diff on every partial fill.
  const filledNodes = diff.directNodes.map((node) => {
    const filled = computeByNodeId.get(node.nodeId);
    if (!filled) return node;
    return { ...node, compute: filled };
  });

  const filledDiff: PreviewDiff = { ...diff, directNodes: filledNodes };

  const allResolved =
    computableIds.length === 0 ||
    computableIds.every((id) => computeByNodeId.has(id));

  return { diff: filledDiff, allResolved };
}
