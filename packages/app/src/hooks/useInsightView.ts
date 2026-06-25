import { useChartEngine } from "@/components/providers/ChartEngineProvider";
import { useDuckDB } from "@/components/providers/DuckDBProvider";
import { getDataFrame, getDataTable } from "@dashframe/core";
import type { EffectiveParams } from "@dashframe/engine";
import {
  buildInsightSQL,
  ensureTableLoaded,
  loadArrowData,
} from "@dashframe/engine-browser";
import type {
  DataFrame,
  DataTable,
  Insight,
  InsightFilter,
  InsightMetric,
  UUID,
} from "@dashframe/types";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Check whether a DataFrame can be served to the native chart engine.
 *
 * The native engine receives data via `uploadArrowTable`, which reads the
 * local IndexedDB Arrow buffer. Remote-backed storage (s3/r2) has no local
 * buffer, so the upload path is not available for those DataFrames.
 *
 * @returns `true` when the DataFrame can be uploaded to the native engine.
 */
export function isNativeCapableDataFrame(dataFrame: DataFrame): boolean {
  return dataFrame.storage.type === "indexeddb";
}

/**
 * What a created view needs to be re-rendered correctly after a remount/HMR.
 *
 * `nativeCapable` MUST travel with the view name: on the desktop path the view
 * may have been created in DuckDB-WASM only (a DataFrame could not be uploaded
 * to the native engine). If a remount restored only the view name and let
 * `nativeCapable` reset to its initial `true`, VisualizationDisplay would skip
 * the WASM fallback and route the chart to the native engine for a view that
 * was intentionally never created there → missing-table error.
 */
interface CachedView {
  viewName: string;
  nativeCapable: boolean;
}

// Module-level cache to track which views have been created
// This survives React Strict Mode's double-invoke and HMR remounts
const createdViewsCache = new Map<string, CachedView>(); // configKey -> CachedView

// Module-level set to track in-flight requests (prevents race conditions)
const pendingRequests = new Set<string>();

/**
 * Clear the view cache.
 *
 * Call this when DuckDB is reinitialized to prevent stale cache hits.
 * The cache maps insight config keys to DuckDB view names, but when DuckDB
 * restarts, those views no longer exist.
 */
export function clearInsightViewCache(): void {
  createdViewsCache.clear();
  pendingRequests.clear();
}

/**
 * Check if a view exists in the cache by insight ID.
 *
 * This is a fast synchronous lookup used by VisualizationPreview to avoid
 * polling DuckDB when the view was already created by useInsightView.
 *
 * @param insightId - The insight ID to check
 * @returns The view name if cached, null otherwise
 */
export function getCachedViewName(insightId: string): string | null {
  // The cache key format is `${insightId}:${joinsKey}` but we want to match by insightId prefix
  // since VisualizationPreview doesn't know about joins
  for (const [key, cached] of createdViewsCache.entries()) {
    if (key.startsWith(`${insightId}:`)) {
      return cached.viewName;
    }
  }
  return null;
}

/**
 * Returns true when the filter references a metric column or alias.
 *
 * Metric filters require HAVING in query mode (post-aggregation), which is
 * incompatible with model-mode DuckDB views (no aggregation is performed).
 * Extracting the check to a module-level predicate keeps `createView` within
 * the sonarjs cognitive-complexity budget.
 */
function isMetricField(field: string, metrics: InsightMetric[]): boolean {
  return metrics.some(
    (m) =>
      m.columnName === field || `metric_${m.id.replace(/-/g, "_")}` === field,
  );
}

/**
 * Strip metric filters from an effective-filter list so the remaining filters
 * are safe to apply in model mode (WHERE only, no aggregation / HAVING).
 */
function stripMetricFilters(
  filters: InsightFilter[],
  metrics: InsightMetric[],
): InsightFilter[] {
  return filters.filter((f) => !isMetricField(f.field, metrics));
}

/**
 * Build the effective-override fields for a model-mode chart view SQL call.
 *
 * Only filters are forwarded — and metric filters are stripped (they require
 * HAVING, incompatible with model mode).  Two things are deliberately NOT
 * forwarded to the chart view:
 *
 * - `effectiveLimit`: the Chart (vgplot/Mosaic) builds its own GROUP BY
 *   aggregation against this view (e.g. `SELECT region, SUM(sales) … GROUP BY
 *   region`).  A `LIMIT N` in the view definition caps the RAW input rows
 *   before aggregation, silently dropping groups and producing wrong totals.
 *   The cell limit applies only to the VirtualTable pagination path
 *   (`useInsightPagination`), which enforces it correctly.
 * - `effectiveSorts`: GROUP BY ignores input row order, so a sort on the raw
 *   model view has no effect on the aggregated chart output. Sort overrides are
 *   applied in the pagination/table path only.
 */
function buildViewSQLOptions(
  effectiveFilters: InsightFilter[] | null,
  metrics: InsightMetric[],
): {
  effectiveFilters?: InsightFilter[];
} {
  const viewFilters =
    effectiveFilters !== null
      ? stripMetricFilters(effectiveFilters, metrics)
      : null;
  return {
    ...(viewFilters !== null &&
      viewFilters.length > 0 && {
        effectiveFilters: viewFilters,
      }),
  };
}

/**
 * Encode an arbitrary string payload as a URL-safe base64 (base64url) suffix.
 *
 * Used to generate SQL-safe view name suffixes for per-cell override views so
 * that two dashboard cells on the same insight with DIFFERENT overrides always
 * map to two distinct DuckDB views (collision-free by construction: the suffix
 * IS the serialised payload, not a lossy hash of it).
 *
 * base64url characters (+/=) are already excluded from valid DuckDB identifiers,
 * so the suffix is safe to embed directly inside quoted view name strings.
 */
function toViewSuffix(payload: string): string {
  // btoa operates on binary strings; TextEncoder gives us the UTF-8 bytes first.
  const bytes = new TextEncoder().encode(payload);
  // Use Array.from to avoid a spread-argument RangeError on large payloads
  // (V8/Bun cap spread args at ~65 536; a filter with many long strings can exceed it).
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  // Standard base64, then convert to base64url (replace +/ with -_ and strip =)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Hook to create a DuckDB view for an Insight.
 *
 * Always creates a view named `insight_view_<insightId>` using buildInsightSQL().
 * This provides a consistent interface for Chart components regardless of
 * whether the insight has joins or not.
 *
 * Triggers lazy DuckDB initialization on first call and handles the loading state
 * while DuckDB initializes.
 *
 * ## Why always create a view
 *
 * - Simpler mental model: Chart always queries `insight_view_*`
 * - Consistent behavior: No special cases for joined vs. non-joined insights
 * - Future-proof: Adding joins later doesn't change the rendering path
 * - Easier debugging: One place to check SQL generation
 *
 * @example
 * ```tsx
 * const { viewName, isReady } = useInsightView(insight);
 *
 * // viewName will always be: "insight_view_<insightId>"
 *
 * return isReady && viewName ? (
 *   <Chart tableName={viewName} ... />
 * ) : null;
 * ```
 */
/**
 * Options for `useInsightView`.
 */
export interface UseInsightViewOptions {
  /**
   * Pre-resolved effective params from `resolveEffectiveParams` (cell overrides
   * coalesced with insight defaults).  When supplied, the view is built with
   * these filters/sorts/limit applied — the insight object itself is not mutated.
   *
   * Absent → the standard model-mode view (no filters) is created, identical to
   * the pre-override behaviour.
   */
  effectiveParams?: EffectiveParams;
}

export function useInsightView(
  insight: Insight | null | undefined,
  options: UseInsightViewOptions = {},
) {
  const { effectiveParams } = options;
  const { connection, isInitialized, isLoading: isDuckDBLoading } = useDuckDB();
  const { connector, uploadArrowTable } = useChartEngine();

  // Stable key for the effective params so the cache differentiates cells that
  // share the same insight but have distinct overrides.  Keyed on FILTERS ONLY:
  // sorts and limit are intentionally NOT applied to the model-mode chart view
  // (sorts don't affect GROUP BY output; limit would wrongly cap pre-aggregation
  // rows — see buildViewSQLOptions), so two cells that differ only in sort/limit
  // share the same view.
  //
  // Serialising to a string produces a primitive that is safe to use in dep
  // arrays without the non-simple-expression lint error.
  const effectiveFiltersKey = effectiveParams?.filters?.length
    ? JSON.stringify(effectiveParams.filters)
    : null;

  // Extract stable dependencies from insight object BEFORE state
  const insightId = insight?.id;
  const baseTableId = insight?.baseTableId;
  // Create stable string key for joins to detect actual changes
  const joinsKey = insight?.joins
    ? JSON.stringify(
        insight.joins.map((j) => ({
          r: j.rightTableId,
          l: j.leftKey,
          rk: j.rightKey,
          t: j.type,
        })),
      )
    : null;

  // Compute config key for cache lookup.
  // Keyed on the effective FILTERS only (the only override dimension that changes
  // the model-mode view); cells differing only in sort/limit reuse one view.
  const configKey = insightId
    ? `${insightId}:${joinsKey}:${effectiveFiltersKey ?? ""}`
    : null;

  // Track the most recently rendered configKey so in-flight createView calls
  // from superseded configs can discard their setState calls rather than
  // overwriting the state that a newer config already wrote.
  //
  // Synced in a useLayoutEffect (NOT a passive useEffect): layout effects
  // flush synchronously inside React's commit phase, before control returns to
  // the event loop. A passive useEffect runs in a later macrotask, leaving a
  // window where config B has committed but the ref still holds A — an
  // in-flight createView for A whose promise resolves as a microtask in that
  // window would read currentConfigKeyRef.current === A, pass its own guard,
  // and write A's resolvedViewName/nativeCapable over B's. useLayoutEffect
  // closes that window because no microtask continuation can interleave before
  // the ref is updated. (This package is the Electron/web renderer — no SSR —
  // so the layout-effect SSR warning does not apply; VisualizationDisplay in
  // the same package already uses useLayoutEffect.)
  //
  // React always flushes layout effects before passive effects, so this runs
  // before the createView (passive) effect each render regardless of source
  // ordering — the ref reflects the current configKey before createView reads
  // it. Updating the ref here rather than during render also satisfies the
  // react-compiler lint rule against ref mutation during render.
  const currentConfigKeyRef = useRef<string | null>(configKey);
  useLayoutEffect(() => {
    currentConfigKeyRef.current = configKey;
  });

  // Check module-level cache for existing view (survives Strict Mode remounts)
  const cachedView = configKey
    ? (createdViewsCache.get(configKey) ?? null)
    : null;
  const cachedViewName = cachedView?.viewName ?? null;

  // Resolved view set by the async effect. The publicly-returned viewName is
  // derived during render so we don't have to synchronously reset it inside
  // the effect when prerequisites aren't met.
  const [resolvedViewName, setResolvedViewName] = useState<string | null>(
    cachedViewName,
  );
  const [resolvedConfigKey, setResolvedConfigKey] = useState<string | null>(
    cachedViewName ? configKey : null,
  );
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether all DataFrames for this insight can be served to the native engine.
   *
   * `true`  — all DataFrames use indexeddb storage and were uploaded successfully;
   *            chart queries will run against the native DuckDB engine.
   * `false` — at least one DataFrame uses remote storage (s3/r2) or had a missing
   *            local Arrow buffer; the view exists in DuckDB-WASM only.
   *            VisualizationDisplay wraps the Chart in a WASM VisualizationProvider
   *            so queries route to WASM instead of hard-failing on the native engine.
   *
   * Only meaningful on the desktop path (when `uploadArrowTable` is set).
   * Always `true` on the WASM-only path.
   *
   * Seeded from the module cache so a remount/HMR that short-circuits view
   * creation (cache hit) restores the original fallback decision instead of
   * resetting to `true` and routing a WASM-only view to the native engine.
   */
  const [nativeCapable, setNativeCapable] = useState<boolean>(
    cachedView?.nativeCapable ?? true,
  );

  // A cache hit for the CURRENT config restores the cached fallback decision.
  // (Initial state only captures the FIRST configKey; this keeps nativeCapable
  // correct when configKey changes to one already in the cache.)
  const nativeCapableForCurrentKey =
    cachedView && resolvedConfigKey !== configKey
      ? cachedView.nativeCapable
      : nativeCapable;

  // Clear stale error when configKey changes to one already in the cache.
  // The cache-hit path returns early before createView runs, so setError(null)
  // in createView's success path never fires on a cache-switch. A prior error
  // from config A must not bleed into a successful cached config B.
  const errorForCurrentKey =
    cachedView && resolvedConfigKey !== configKey ? null : error;

  const prerequisitesReady =
    Boolean(connection) &&
    isInitialized &&
    !isDuckDBLoading &&
    Boolean(insightId) &&
    Boolean(baseTableId) &&
    Boolean(configKey);

  // The resolved view is only valid for its own configKey. If configKey has
  // changed, fall back to the module cache (populated by createView below).
  const viewNameForCurrentKey =
    resolvedConfigKey === configKey ? resolvedViewName : cachedViewName;
  const viewName = prerequisitesReady ? viewNameForCurrentKey : null;
  const isReady = prerequisitesReady && viewName !== null;

  useEffect(() => {
    if (
      !connection ||
      !isInitialized ||
      isDuckDBLoading ||
      !insightId ||
      !baseTableId ||
      !configKey
    ) {
      return;
    }

    // Module-level cache is read during render (see `cachedViewName`), so
    // there is nothing to synchronously sync here when it's already populated.
    if (createdViewsCache.has(configKey)) {
      return;
    }

    // Prevent duplicate in-flight requests for same config (module-level)
    if (pendingRequests.has(configKey)) {
      return;
    }

    // Mark this config as in-flight (module-level, survives unmount/remount)
    pendingRequests.add(configKey);

    // Capture stable values at effect start (insight object may change during async)
    const joins = insight?.joins ?? [];
    const insightMetrics = insight?.metrics ?? [];
    // Snapshot effective filters for this view (null = no override = unfiltered
    // model view).  Sorts/limit are NOT applied to the chart view — see
    // buildViewSQLOptions — so only filters are snapshotted here.
    const snapshotEffectiveFilters = effectiveParams?.filters ?? null;

    // eslint-disable-next-line sonarjs/cognitive-complexity -- defensive stale-state guards (currentConfigKeyRef checks) after every await legitimately raise complexity; extracting further would obscure the guard pattern
    const createView = async () => {
      try {
        // Double-check cache in case another effect already created it
        if (createdViewsCache.has(configKey)) {
          const cached = createdViewsCache.get(configKey)!;
          setResolvedViewName(cached.viewName);
          setResolvedConfigKey(configKey);
          // Restore the cached fallback decision — never assume native-capable.
          setNativeCapable(cached.nativeCapable);
          pendingRequests.delete(configKey);
          return;
        }

        // Get base table
        const baseTable = await getDataTable(baseTableId);
        if (!baseTable || !baseTable.dataFrameId) {
          pendingRequests.delete(configKey);
          if (currentConfigKeyRef.current !== configKey) return;
          setError("Base table not found");
          setResolvedViewName(null);
          return;
        }

        // Ensure base DataFrame is loaded
        const baseDataFrame = await getDataFrame(baseTable.dataFrameId);
        if (!baseDataFrame) {
          pendingRequests.delete(configKey);
          if (currentConfigKeyRef.current !== configKey) return;
          setError("Base DataFrame not found");
          setResolvedViewName(null);
          return;
        }

        // Collect all DataFrames to load (base + joined tables) for parallel loading
        const dataFramesToLoad: Array<{
          dataFrame: Awaited<ReturnType<typeof getDataFrame>>;
        }> = [{ dataFrame: baseDataFrame }];

        // Resolve joined tables
        const joinedTables = new Map<UUID, DataTable>();
        const joinLoadPromises = joins.map(async (join) => {
          const joinTable = await getDataTable(join.rightTableId);
          if (joinTable) {
            joinedTables.set(join.rightTableId, joinTable);
            if (joinTable.dataFrameId) {
              const joinDataFrame = await getDataFrame(joinTable.dataFrameId);
              if (joinDataFrame) {
                dataFramesToLoad.push({ dataFrame: joinDataFrame });
              }
            }
          }
        });

        // Wait for all join table resolutions
        await Promise.all(joinLoadPromises);

        // Load ALL DataFrames into DuckDB-WASM in parallel.
        // On desktop, also upload each Arrow IPC buffer to the native engine
        // so chart queries running via the loopback connector can reference
        // the same table names (df_<id>). The table name formula mirrors
        // engine-browser's makeTableName: `df_${dataFrameId.replace(/-/g, "_")}`.
        //
        // Per-insight fallback: if any DataFrame cannot be uploaded to the native
        // engine (remote storage, missing local buffer), we record `allNativeCapable
        // = false` rather than throwing. The view is still created in DuckDB-WASM so
        // the WASM path can render it. VisualizationDisplay reads `nativeCapable` and
        // wraps the Chart in a WASM VisualizationProvider when false, so chart
        // queries route to WASM instead of hard-failing on the native engine.
        let allNativeCapable = true;

        await Promise.all(
          dataFramesToLoad.map(async ({ dataFrame }) => {
            if (!dataFrame) return;
            await ensureTableLoaded(dataFrame, connection);
            // Desktop native path: upload the DataFrame's Arrow buffer so the
            // native engine has the same df_* table the WASM engine has.
            if (uploadArrowTable) {
              if (!isNativeCapableDataFrame(dataFrame)) {
                // Remote storage (s3/r2) — no local buffer to upload.
                // Fall back to WASM for this insight rather than hard-failing.
                allNativeCapable = false;
                return;
              }
              const arrowBytes = await loadArrowData(dataFrame.storage.key);
              if (!arrowBytes) {
                // Local Arrow buffer is missing (e.g. data was evicted from
                // IndexedDB). Fall back to WASM rather than hard-failing.
                allNativeCapable = false;
                return;
              }
              const tableName = `df_${dataFrame.id.replace(/-/g, "_")}`;
              await uploadArrowTable(tableName, arrowBytes);
            }
          }),
        );

        // Build SQL for the model (all columns, no aggregation).
        // Metric filters are stripped (they require HAVING, incompatible with
        // model mode); they still apply in useInsightPagination query mode.
        const sql = buildInsightSQL(
          baseTable,
          joinedTables,
          { joins, metrics: insightMetrics } as Insight,
          {
            mode: "model",
            ...buildViewSQLOptions(snapshotEffectiveFilters, insightMetrics),
          },
        );

        if (!sql) {
          pendingRequests.delete(configKey);
          if (currentConfigKeyRef.current !== configKey) return;
          setError("Failed to build SQL for insight view");
          setResolvedViewName(null);
          return;
        }

        // View name: base insight view for the unfiltered case.  When effective
        // filters are present (cell override), append a collision-free base64url
        // suffix derived from the filters so each distinct filtered subset gets
        // its own view in DuckDB.  Sorts/limit don't affect the view, so they are
        // not part of the name.
        const idSafe = insightId.replace(/-/g, "_");
        const hasFilterOverride =
          snapshotEffectiveFilters !== null &&
          snapshotEffectiveFilters.length > 0;
        const newViewName = hasFilterOverride
          ? `insight_view_${idSafe}_cell_${toViewSuffix(JSON.stringify(snapshotEffectiveFilters))}`
          : `insight_view_${idSafe}`;
        const createViewSql = `CREATE OR REPLACE VIEW "${newViewName}" AS ${sql}`;
        await connection.query(createViewSql);

        // Desktop: chart queries run against the native engine, so the view
        // must also exist there — but only when all DataFrames were successfully
        // uploaded (nativeCapable path). When any DataFrame fell back to WASM,
        // skip the native view creation; VisualizationDisplay will route the
        // Chart's queries to the WASM engine instead.
        if (connector && allNativeCapable) {
          await connector.query({ type: "exec", sql: createViewSql });
        }

        // Store in module-level cache (survives Strict Mode and HMR). The
        // fallback decision travels with the view name so a later remount that
        // hits this cache restores the correct engine routing.
        createdViewsCache.set(configKey, {
          viewName: newViewName,
          nativeCapable: allNativeCapable,
        });
        pendingRequests.delete(configKey);

        // Guard: if the component has moved on to a different configKey while
        // this async path was in-flight, discard these results. The newer
        // config's createView will (or already did) set the correct state.
        if (currentConfigKeyRef.current !== configKey) return;

        setResolvedViewName(newViewName);
        setResolvedConfigKey(configKey);
        setNativeCapable(allNativeCapable);
        setError(null);
      } catch (err) {
        console.error("[useInsightView] Failed to create view:", err);
        pendingRequests.delete(configKey);
        if (currentConfigKeyRef.current !== configKey) return;
        setError(err instanceof Error ? err.message : "Failed to create view");
        setResolvedViewName(null);
      }
    };

    createView();

    // No cleanup needed - module-level state persists across unmounts
    // IMPORTANT: Only depend on stable primitive values
    // - Do NOT include `insight` (object reference changes every render)
    // - Do NOT include `isReady` (would create feedback loop when we setIsReady)
    // - `joinsKey` is a serialized representation of `insight.joins`, so we don't need `insight.joins` directly
    // - `connector`/`uploadArrowTable` are stable (set once at bootstrap)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- joinsKey/effectiveFiltersKey track insight.joins/overrides changes; connector/uploadArrowTable are stable
  }, [
    connection,
    isInitialized,
    isDuckDBLoading,
    insightId,
    baseTableId,
    joinsKey,
    configKey,
    effectiveFiltersKey, // re-run when the cell's filter override changes
    connector,
    uploadArrowTable,
  ]);

  return {
    /** The DuckDB view name to query (always `insight_view_<insightId>`) */
    viewName,
    /** Whether the view is ready to be queried */
    isReady,
    /** Error message if view creation failed, or null when the current config is clean. */
    error: errorForCurrentKey,
    /**
     * Whether all DataFrames for this insight were successfully uploaded to
     * the native engine. `false` means at least one DataFrame uses remote
     * storage (s3/r2) or had a missing local Arrow buffer; the view exists in
     * DuckDB-WASM only and the Chart must route queries there instead.
     *
     * Only meaningful on the desktop path. Always `true` on the WASM path.
     */
    nativeCapable: nativeCapableForCurrentKey,
  };
}
