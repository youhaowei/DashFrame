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
 *
 * DATA-MODEL NOTE (the load-bearing correctness detail): a node's `before` is
 * the RAW `insights` DB row — the query config lives under `before.definition`
 * (a StoredInsightDefinition), NOT at `before` top-level. `proposedDefinition`
 * is assembled from RAW COMMAND ARGS, whose key names DIFFER from the stored
 * definition (e.g. `fieldIds` not `selectedFields`, `source.sourceId` not
 * `baseTableId`). `foldInsightArgs` reconciles both into a single canonical
 * insight shape so the after-count reflects the PROPOSED query, not the old one.
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
import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Helpers to coerce proposedDefinition / before into a canonical Insight shape
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
 * Pull the canonical StoredInsightDefinition out of a `before` slice.
 *
 * `before` is the raw `insights` DB row: the query config lives under
 * `before.definition`. We unwrap defensively — if `.definition` is an object we
 * use it; otherwise we fall back to `before` itself (forward-compat for a slice
 * that is already a bare definition).
 */
function unwrapDefinition(
  before: Record<string, unknown> | null,
): Record<string, unknown> {
  if (before === null) return {};
  const definition = before.definition;
  if (
    definition &&
    typeof definition === "object" &&
    !Array.isArray(definition)
  )
    return definition as Record<string, unknown>;
  return before;
}

/**
 * Read a `{ sourceType, sourceId }` source descriptor's `sourceId` if present.
 */
function readSourceId(
  source: unknown,
): { sourceId: UUID; source: Record<string, unknown> } | null {
  if (!source || typeof source !== "object") return null;
  const rec = source as Record<string, unknown>;
  if (typeof rec.sourceId !== "string") return null;
  return { sourceId: rec.sourceId as UUID, source: rec };
}

/**
 * Coerce a canonical StoredInsightDefinition record (already unwrapped — config
 * at top level, stored key names) into a partial insight shape.
 */
function definitionToInsightLike(
  def: Record<string, unknown>,
  nodeId: UUID,
): InsightLike {
  const sourceId = readSourceId(def.source)?.sourceId;
  const baseTableId =
    typeof def.baseTableId === "string" ? (def.baseTableId as UUID) : sourceId;

  return {
    id: nodeId,
    baseTableId: (baseTableId ?? "") as UUID,
    selectedFields: Array.isArray(def.selectedFields)
      ? (def.selectedFields as UUID[])
      : [],
    metrics: Array.isArray(def.metrics)
      ? (def.metrics as Insight["metrics"])
      : [],
    joins: Array.isArray(def.joins)
      ? (def.joins as Insight["joins"])
      : undefined,
    filters: Array.isArray(def.filters)
      ? (def.filters as Insight["filters"])
      : undefined,
    sorts: Array.isArray(def.sorts)
      ? (def.sorts as Insight["sorts"])
      : undefined,
  };
}

/**
 * Command-arg keys that carry a genuinely-INCREMENTAL insight edit which cannot
 * be reconstructed into the final shape from args alone (the original array
 * element / index must be replayed against the canonical definition):
 *   - AddField (`field`) / UpdateField (`fieldId`,`updates`) / RemoveField (`fieldId`)
 *   - AddMetric (`metric`) / UpdateMetric (`metricId`,`updates`) / RemoveMetric (`metricId`)
 *   - UpdateJoin / RemoveJoin (`joinIndex`,`updates`)
 *
 * If `proposedDefinition` carries any of these (and no replace-all array
 * superseded the same slice), `foldInsightArgs` returns null — the proposed
 * shape is non-computable, so the renderer shows an honest "unavailable" state
 * rather than a SILENT STALE count (the canonical count mislabeled as proposed).
 * `join` (AddJoin) is excluded: it carries a full join object and IS foldable.
 */
const UNFOLDABLE_INCREMENTAL_KEYS = [
  "field",
  "fieldId",
  "metric",
  "metricId",
  "joinIndex",
  "updates",
] as const;

/**
 * Replace-all command-arg array keys that map 1:1 onto stored-definition keys
 * (CreateInsight / SetInsightFilter / SetInsightSort / replace-all metrics/joins).
 * `fieldIds`→`selectedFields` is handled separately (key rename).
 */
const REPLACE_ALL_KEYS = [
  "selectedFields",
  "metrics",
  "filters",
  "sorts",
  "joins",
] as const;

/**
 * Fold raw command args (`proposedDefinition`) onto a canonical base definition,
 * producing the SAME final insight shape the mutation would persist.
 *
 * The command-arg key names differ from the stored-definition names; this maps
 * them explicitly (see apps/server/src/functions/commands.ts):
 *   - `fieldIds`            → selectedFields  (SelectFields: replace-all)
 *   - `source`             → baseTableId = source.sourceId (+ keep source)
 *   - `selectedFields`     → pass through    (CreateInsight)
 *   - `filters`/`sorts`/`metrics`/`joins` → pass through (replace-all commands)
 *   - `baseTableId`        → pass through if present
 *   - `join` (object)      → append/merge onto joins[] (AddJoin)
 *
 * Returns null for an un-foldable INCREMENTAL edit (see
 * UNFOLDABLE_INCREMENTAL_KEYS) so `buildProposedInsight` propagates null and the
 * renderer shows "unavailable" — fail-honest rather than a silent stale count.
 */
function foldInsightArgs(
  canonicalDef: Record<string, unknown>,
  proposedArgs: Record<string, unknown>,
  nodeId: UUID,
): InsightLike | null {
  // Fail-honest on un-foldable incremental args: we cannot reconstruct the
  // proposed shape from a single field/metric/join element + the canonical def
  // without replaying the command, so computing here would mislabel the
  // canonical (stale) count as the proposed one. Return null → "unavailable".
  for (const key of UNFOLDABLE_INCREMENTAL_KEYS) {
    if (proposedArgs[key] !== undefined) return null;
  }

  // Start from the canonical definition (stored key names), then overlay the
  // proposed change with key-name translation.
  const folded: Record<string, unknown> = { ...canonicalDef };

  // source → baseTableId + keep source (SetInsightSource / CreateInsight).
  const proposedSource = readSourceId(proposedArgs.source);
  if (proposedSource) {
    folded.source = proposedSource.source;
    folded.baseTableId = proposedSource.sourceId;
  }
  // Explicit baseTableId arg (rare, but pass through).
  if (typeof proposedArgs.baseTableId === "string") {
    folded.baseTableId = proposedArgs.baseTableId;
  }

  // fieldIds → selectedFields (SelectFields is replace-all).
  if (Array.isArray(proposedArgs.fieldIds)) {
    folded.selectedFields = proposedArgs.fieldIds;
  }
  // Replace-all arrays whose arg names match the stored names — pass through.
  for (const key of REPLACE_ALL_KEYS) {
    if (Array.isArray(proposedArgs[key])) folded[key] = proposedArgs[key];
  }

  // Incremental single-join arg (AddJoin carries a full `join` object).
  if (
    proposedArgs.join &&
    typeof proposedArgs.join === "object" &&
    !Array.isArray(proposedArgs.join)
  ) {
    folded.joins = foldSingleJoin(
      folded.joins,
      proposedArgs.join as Record<string, unknown>,
    );
  }

  return definitionToInsightLike(folded, nodeId);
}

/**
 * Fold one AddJoin `join` object onto the existing joins array: merge by
 * `rightTableId` if a join on that table already exists, else append.
 */
function foldSingleJoin(
  existingJoins: unknown,
  incoming: Record<string, unknown>,
): Record<string, unknown>[] {
  const joins = Array.isArray(existingJoins)
    ? [...(existingJoins as Record<string, unknown>[])]
    : [];
  const idx = joins.findIndex((j) => j.rightTableId === incoming.rightTableId);
  if (idx >= 0) joins[idx] = { ...joins[idx], ...incoming };
  else joins.push(incoming);
  return joins;
}

/**
 * Build the PROPOSED (post-batch) insight shape by folding command args onto the
 * canonical `before.definition` base. Returns null when the result has no
 * resolvable base table (genuinely non-computable — renderer shows "unavailable").
 */
function buildProposedInsight(node: PreviewDirectNode): InsightLike | null {
  if (node.kind !== "insight") return null;

  const canonicalDef = unwrapDefinition(node.before);
  const result = foldInsightArgs(
    canonicalDef,
    node.proposedDefinition,
    node.nodeId,
  );
  // null = un-foldable incremental edit (fail-honest → "unavailable").
  if (!result || !result.baseTableId) return null;
  return result;
}

/**
 * Build the canonical (pre-batch) insight shape for rowCountBefore, read from
 * `before.definition`. Returns null for `create` (no canonical row existed).
 */
function buildCanonicalInsight(node: PreviewDirectNode): InsightLike | null {
  if (node.kind !== "insight" || node.before === null) return null;
  const result = definitionToInsightLike(
    unwrapDefinition(node.before),
    node.nodeId,
  );
  if (!result.baseTableId) return null;
  return result;
}

// ---------------------------------------------------------------------------
// Proposed-source resolution (FIX 4)
// ---------------------------------------------------------------------------

/**
 * A lookup over a diff's direct nodes keyed by `nodeId`, used to resolve a
 * proposed source (a DataTable or insight created/changed IN THIS BATCH) before
 * falling back to the canonical client store.
 */
type DirectNodeIndex = Map<UUID, PreviewDirectNode>;

function indexDirectNodes(diff: PreviewDiff): DirectNodeIndex {
  const index: DirectNodeIndex = new Map();
  for (const node of diff.directNodes) index.set(node.nodeId, node);
  return index;
}

/**
 * Resolve a base-table id to a loadable DataTable.
 *
 * Resolution order:
 *  1. If the id names a `dataTable` direct node IN THIS DIFF (proposed/refreshed
 *     in the same batch), use its proposed/canonical definition. The DataFrame
 *     it references must already be in local DuckDB for compute to succeed; a
 *     brand-new DataTable whose DataFrame is not yet local returns null (honest
 *     "unavailable" rather than a wrong count).
 *  2. Fall back to the canonical client store (`getDataTable`).
 *
 * Insight-on-insight sources resolve their base recursively via the same diff
 * index; if the source insight is itself a proposed node we cannot materialise a
 * DataTable for it client-side (no DuckDB view exists for an un-persisted
 * insight), so that case returns null → "unavailable".
 */
async function resolveBaseTable(
  baseTableId: UUID,
  nodeIndex: DirectNodeIndex,
): Promise<DataTable | null> {
  const proposedNode = nodeIndex.get(baseTableId);
  if (proposedNode && proposedNode.kind === "dataTable") {
    // A DataTable proposed/changed in this batch. Its proposedDefinition (or
    // before) carries the schema metadata; the DataFrame must be local. We read
    // the canonical store FIRST (covers update/noop where the row exists) and
    // fall back to whatever the proposed definition can give us.
    const def = proposedNode.proposedDefinition;
    const proposedFrameId =
      typeof def.dataFrameId === "string" ? def.dataFrameId : undefined;
    const canonical = await getDataTable(baseTableId);
    if (canonical?.dataFrameId) {
      // Same-batch update may re-point this table's dataFrameId. Overlay the
      // PROPOSED frame id so the count reflects the proposed table, not the
      // stale canonical one. (No proposed override → use canonical as-is.)
      return proposedFrameId
        ? { ...canonical, dataFrameId: proposedFrameId }
        : canonical;
    }
    // create-node DataTable: the canonical store has no row (preview rolled
    // back). We can only compute if a proposed definition names a local
    // dataFrameId. Otherwise the DataFrame isn't local → unavailable.
    if (proposedFrameId) {
      return def as unknown as DataTable;
    }
    return null;
  }
  if (proposedNode && proposedNode.kind === "insight") {
    // Insight-on-insight where the source is itself a proposed node: no DuckDB
    // view exists for an un-persisted insight, so it's not computable here.
    return null;
  }
  // Not in this diff — resolve from the canonical client store.
  return (await getDataTable(baseTableId)) ?? null;
}

// ---------------------------------------------------------------------------
// DuckDB query helpers
// ---------------------------------------------------------------------------

type ResolvedTables = {
  baseTable: DataTable;
  joinedTables: Map<UUID, DataTable>;
};

/**
 * Ensure all DataFrames for an insight are loaded in DuckDB and return the
 * resolved `{ baseTable, joinedTables }`. Resolved ONCE per insight shape and
 * passed into both computeRowCount and computeHead (FIX 7 — no double-load).
 */
async function ensureInsightDataFrames(
  insightLike: InsightLike,
  conn: import("@duckdb/duckdb-wasm").AsyncDuckDBConnection,
  nodeIndex: DirectNodeIndex,
): Promise<ResolvedTables | null> {
  const baseTable = await resolveBaseTable(insightLike.baseTableId, nodeIndex);
  if (!baseTable?.dataFrameId) return null;

  const baseDF = await getDataFrame(baseTable.dataFrameId);
  if (!baseDF) return null;

  await ensureTableLoaded(baseDF, conn);

  const joinedTables = new Map<UUID, DataTable>();
  const joins = insightLike.joins ?? [];
  await Promise.all(
    joins.map(async (join) => {
      const joinTable = await resolveBaseTable(join.rightTableId, nodeIndex);
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
 * Convert a DuckDB COUNT(*) cell to a `number | null`, preserving correctness in
 * the face of IEEE-754 limits. Same discipline as the data-preview numeric
 * display: never silently emit a wrong precise number.
 *
 * A COUNT(*) above Number.MAX_SAFE_INTEGER (2^53−1 ≈ 9e15) cannot be represented
 * exactly as a JS number; `Number(bigint)` would round it. We guard that case by
 * returning null so the renderer shows an honest "unavailable" state rather than
 * a count that is off by a few. (Real row counts at that scale are not expected
 * client-side, but the guard keeps the display honest if it ever happens.)
 */
function countCellToNumber(cell: unknown): number | null {
  if (typeof cell === "bigint") {
    if (
      cell > BigInt(Number.MAX_SAFE_INTEGER) ||
      cell < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      return null;
    }
    return Number(cell);
  }
  if (typeof cell === "number") {
    return Number.isSafeInteger(cell) ? cell : null;
  }
  return null;
}

/**
 * Compute the row count for a pre-resolved insight against local DuckDB.
 * Takes the pre-resolved tables (FIX 7) so it never re-loads DataFrames.
 */
async function computeRowCount(
  insightLike: InsightLike,
  tables: ResolvedTables,
  conn: import("@duckdb/duckdb-wasm").AsyncDuckDBConnection,
): Promise<number | null> {
  const { baseTable, joinedTables } = tables;

  // Use "query" mode — that gives the aggregated result set (matching what the
  // insight would actually produce). Fall back to "model" if no selectedFields/metrics.
  const hasAggregation =
    insightLike.selectedFields.length > 0 ||
    (insightLike.metrics?.length ?? 0) > 0;
  const mode = hasAggregation ? "query" : "model";

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
    return countCellToNumber(row.cnt);
  } catch {
    return null;
  }
}

/** HEAD_N is the number of sample rows to return in the `head` slot. */
const HEAD_N = 5;

/**
 * The "unavailable" compute sentinel — a resolved-but-empty result. Distinct
 * from `undefined` (pending): the renderer shows an honest "unavailable" state
 * for this, a spinner for `undefined`.
 */
const EMPTY_COMPUTE: PreviewCompute = {
  rowCountBefore: null,
  rowCountAfter: null,
  head: [],
};

/**
 * Compute the head rows (first N rows) for a pre-resolved insight.
 * Takes the pre-resolved tables (FIX 7) so it never re-loads DataFrames.
 */
async function computeHead(
  insightLike: InsightLike,
  tables: ResolvedTables,
  conn: import("@duckdb/duckdb-wasm").AsyncDuckDBConnection,
): Promise<Array<Record<string, unknown>>> {
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

/**
 * Compute the full PreviewCompute for one node: resolve the proposed and
 * canonical insight tables ONCE each (FIX 7), then derive counts + head.
 */
async function computeNode(
  proposed: InsightLike,
  canonical: InsightLike | null,
  conn: import("@duckdb/duckdb-wasm").AsyncDuckDBConnection,
  nodeIndex: DirectNodeIndex,
): Promise<PreviewCompute> {
  const [proposedTables, canonicalTables] = await Promise.all([
    ensureInsightDataFrames(proposed, conn, nodeIndex),
    canonical
      ? ensureInsightDataFrames(canonical, conn, nodeIndex)
      : Promise.resolve(null),
  ]);

  if (!proposedTables) {
    // Proposed source not resolvable client-side → honest "unavailable".
    return { rowCountBefore: null, rowCountAfter: null, head: [] };
  }

  const [rowCountAfter, head, rowCountBefore] = await Promise.all([
    computeRowCount(proposed, proposedTables, conn),
    computeHead(proposed, proposedTables, conn),
    canonical && canonicalTables
      ? computeRowCount(canonical, canonicalTables, conn)
      : Promise.resolve(null),
  ]);

  return { rowCountBefore, rowCountAfter, head };
}

// ---------------------------------------------------------------------------
// Stale-guard reducer (FIX 2) — extracted as a pure function for unit testing
// ---------------------------------------------------------------------------

interface ComputeState {
  diff: PreviewDiff | null;
  computeByNodeId: Map<string, PreviewCompute>;
}

/**
 * Merge a freshly-resolved compute into state, guarding against stale writes.
 *
 * `forDiff` is the diff the result was computed for; `currentDiff` is the diff
 * the hook currently cares about (the live prop at merge time).
 *
 * Three cases:
 *  - `forDiff !== currentDiff` → STALE: the user has moved on (opened diff B
 *    while A was still resolving). The late A result must NOT touch state —
 *    return `prev` unchanged. This is the A→B race guard.
 *  - `forDiff === currentDiff` but `prev.diff !== forDiff` → the FIRST result of
 *    a freshly-swapped-in diff: reset to a new map keyed to `forDiff`, dropping
 *    the previous diff's stale entries.
 *  - `forDiff === currentDiff === prev.diff` → normal progressive merge.
 *
 * Pure + total: makes the A→B race testable without a DuckDB mock-thicket.
 */
export function mergeComputeResult(
  prev: ComputeState,
  forDiff: PreviewDiff,
  currentDiff: PreviewDiff | null,
  nodeId: string,
  result: PreviewCompute,
): ComputeState {
  // Stale guard: a late result for a superseded diff must not clobber the
  // current diff's state — drop it entirely.
  if (forDiff !== currentDiff) return prev;
  // First result of a freshly-active diff: start a fresh map keyed to it.
  // Otherwise progressive-merge into the existing map.
  const baseMap =
    prev.diff === forDiff
      ? prev.computeByNodeId
      : new Map<string, PreviewCompute>();
  const next = new Map(baseMap);
  next.set(nodeId, result);
  return { diff: forDiff, computeByNodeId: next };
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
 * - In-flight queries are cancelled on diff-swap / unmount; stale results for a
 *   superseded diff are dropped (FIX 2).
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
  // the map via the functional updater, keeping cascading render cycles minimal.
  const [state, setState] = useState<ComputeState>({
    diff,
    computeByNodeId: new Map(),
  });

  // Stable mirror of which nodes have COMPLETED compute for the active diff. The
  // effect reads THIS for its skip-check (not the captured `state`, which would
  // be stale — `state` is excluded from the effect deps to avoid re-running on
  // every partial fill). Crucially we mark a node done on COMPLETION, not on
  // kick: if the effect re-runs for the same diff after a cancellation (e.g. a
  // DuckDB reconnect flips `isInitialized`), a node whose work was cancelled
  // mid-flight is NOT yet in this set, so it re-kicks rather than being skipped
  // forever. The ref tracks the active diff identity + the completed-node ids.
  const resolvedRef = useRef<{ diff: PreviewDiff | null; ids: Set<string> }>({
    diff,
    ids: new Set(),
  });

  // Always-current mirror of the live `diff` prop. The stale-guard reducer reads
  // this (inside async callbacks) to distinguish a legitimate new-diff result
  // from a superseded one. Updated INSIDE the effect (not during render) — the
  // effect re-runs on every `diff` change, so the mirror stays current for the
  // async callbacks without an illegal ref-write during render.
  const currentDiffRef = useRef<PreviewDiff | null>(diff);

  // Derive the active compute map: if the stored diff has diverged from the
  // current diff (new preview opened), treat the map as empty until the async
  // fills for the new diff start arriving.
  const computeByNodeId =
    state.diff === diff
      ? state.computeByNodeId
      : new Map<string, PreviewCompute>();

  // Keep the live-diff mirror current on every `diff` change — independent of
  // DuckDB readiness, so a late async result is correctly judged stale even if
  // the compute effect below early-returned (DuckDB not yet ready) for diff B.
  useEffect(() => {
    currentDiffRef.current = diff;
  }, [diff]);

  // Kick off compute for each insight node when DuckDB is ready.
  useEffect(() => {
    if (!diff || !connection || !isInitialized) return;

    const conn = connection;
    const thisDiff = diff;
    const nodeIndex = indexDirectNodes(diff);

    // Reset the resolved-id mirror when the diff identity changes.
    if (resolvedRef.current.diff !== diff) {
      resolvedRef.current = { diff, ids: new Set() };
    }

    // Cancellation flag: flipped in cleanup so late async results bail out and
    // do not touch state or hold the single DuckDB-WASM worker (FIX 2a).
    let cancelled = false;

    // Dedupe kicks WITHIN this single effect pass. Completed-node skipping uses
    // the cross-render `resolvedRef`; this local set only prevents kicking the
    // same node twice in one pass (it can't span passes, so a cancelled node
    // re-kicks on the next pass).
    const kickedThisPass = new Set<string>();

    // Commit a node's result: mark it COMPLETED for the active diff (so a
    // same-diff re-run skips it, but only when still the live diff so a stale
    // result can't poison the ref) and write it through the stale-guard reducer.
    const commit = (nodeId: string, computeResult: PreviewCompute) => {
      if (resolvedRef.current.diff === thisDiff) {
        resolvedRef.current.ids.add(nodeId);
      }
      setState((prev) =>
        mergeComputeResult(
          prev,
          thisDiff,
          currentDiffRef.current,
          nodeId,
          computeResult,
        ),
      );
    };

    for (const node of diff.directNodes) {
      // Only insight nodes get compute; skip noop (unchanged) nodes.
      if (node.kind !== "insight") continue;
      if (node.change === "noop") continue;

      // Skip nodes already COMPLETED for this diff (cross-render, via the ref)
      // or already kicked earlier in this same pass.
      if (resolvedRef.current.ids.has(node.nodeId)) continue;
      if (kickedThisPass.has(node.nodeId)) continue;
      kickedThisPass.add(node.nodeId);

      const nodeId = node.nodeId;
      const proposed = buildProposedInsight(node);
      // Changed insight node we cannot compute (un-foldable incremental edit or
      // no resolvable base table): commit the empty sentinel NOW so the renderer
      // shows the honest "unavailable" state instead of a stuck pending spinner.
      if (!proposed) {
        commit(nodeId, EMPTY_COMPUTE);
        continue;
      }

      const canonical = buildCanonicalInsight(node);

      // Fire-and-forget: each node resolves independently.
      (async () => {
        if (cancelled) return;
        let computeResult: PreviewCompute;
        try {
          computeResult = await computeNode(
            proposed,
            canonical,
            conn,
            nodeIndex,
          );
        } catch {
          // Non-fatal: empty sentinel → allResolved stops waiting, renderer
          // shows the honest "unavailable" state.
          computeResult = EMPTY_COMPUTE;
        }
        // Bail before writing if a swap/unmount happened mid-flight (FIX 2a).
        if (cancelled) return;
        commit(nodeId, computeResult);
      })();
    }

    return () => {
      cancelled = true;
    };
    // `state` is intentionally excluded from deps: including it would re-run on
    // every partial fill, re-kicking compute. The skip-check reads `resolvedRef`
    // (a stable ref that mirrors the active diff + completed-node ids), so it is
    // reliable without `state` in the dependency array.
  }, [diff, connection, isInitialized]);

  if (!diff) return { diff: null, allResolved: true };

  // Every changed insight node gets a compute slot — either a real count or the
  // empty sentinel ("unavailable"). Non-computable nodes (un-foldable
  // incremental edit, no base table) resolve synchronously to the sentinel, so
  // they still count toward allResolved (they are not stuck pending).
  const computableIds = diff.directNodes
    .filter((n) => n.kind === "insight" && n.change !== "noop")
    .map((n) => n.nodeId);

  // Build the filled diff — shallow-clone only; mutate compute slots per-node
  // rather than cloning the entire diff on every partial fill.
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
