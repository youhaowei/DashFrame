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
  InsightSort,
  UUID,
} from "@dashframe/types";
import { useEffect, useState } from "react";

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
 * Build the effective-override fields for a model-mode chart view SQL call,
 * stripping metric filters (they require HAVING, incompatible with model mode).
 */
function buildViewSQLOptions(
  effectiveFilters: InsightFilter[] | null,
  effectiveSorts: InsightSort[] | undefined,
  effectiveLimit: number | undefined,
  metrics: InsightMetric[],
): {
  effectiveFilters?: InsightFilter[];
  effectiveSorts?: InsightSort[];
  effectiveLimit?: number;
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
    ...(effectiveSorts?.length && { effectiveSorts }),
    ...(effectiveLimit !== undefined && { effectiveLimit }),
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
  // share the same insight but have distinct overrides.  Includes filters, sorts,
  // and limit so every distinct override combination gets its own cached view.
  //
  // Serialising to a string produces a primitive that is safe to use in dep
  // arrays without the non-simple-expression lint error.
  const effectiveParamsKey = effectiveParams
    ? JSON.stringify({
        f: effectiveParams.filters,
        s: effectiveParams.sorts,
        l: effectiveParams.limit,
      })
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
  // Incorporates all override dimensions (filters + sorts + limit) so that each
  // distinct override combination on the same insight gets its own cached view.
  const configKey = insightId
    ? `${insightId}:${joinsKey}:${effectiveParamsKey ?? ""}`
    : null;

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
    // Snapshot effective params for this view (null = no override = unfiltered model view)
    const snapshotEffectiveFilters = effectiveParams?.filters ?? null;
    const snapshotEffectiveSorts = effectiveParams?.sorts;
    const snapshotEffectiveLimit = effectiveParams?.limit;

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
          setError("Base table not found");
          setResolvedViewName(null);
          pendingRequests.delete(configKey);
          return;
        }

        // Ensure base DataFrame is loaded
        const baseDataFrame = await getDataFrame(baseTable.dataFrameId);
        if (!baseDataFrame) {
          setError("Base DataFrame not found");
          setResolvedViewName(null);
          pendingRequests.delete(configKey);
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
            ...buildViewSQLOptions(
              snapshotEffectiveFilters,
              snapshotEffectiveSorts,
              snapshotEffectiveLimit,
              insightMetrics,
            ),
          },
        );

        if (!sql) {
          setError("Failed to build SQL for insight view");
          setResolvedViewName(null);
          pendingRequests.delete(configKey);
          return;
        }

        // View name: base insight view for the unfiltered/unoverridden case.
        // When any effective override is present (filters, sorts, or limit),
        // append a collision-free base64url suffix derived from the full params
        // so each distinct override combination gets its own view in DuckDB.
        const idSafe = insightId.replace(/-/g, "_");
        const hasOverride =
          (snapshotEffectiveFilters !== null &&
            snapshotEffectiveFilters.length > 0) ||
          (snapshotEffectiveSorts !== undefined &&
            snapshotEffectiveSorts.length > 0) ||
          snapshotEffectiveLimit !== undefined;
        const newViewName = hasOverride
          ? `insight_view_${idSafe}_cell_${toViewSuffix(JSON.stringify({ f: snapshotEffectiveFilters, s: snapshotEffectiveSorts, l: snapshotEffectiveLimit }))}`
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

        setResolvedViewName(newViewName);
        setResolvedConfigKey(configKey);
        setNativeCapable(allNativeCapable);
        setError(null);
      } catch (err) {
        console.error("[useInsightView] Failed to create view:", err);
        setError(err instanceof Error ? err.message : "Failed to create view");
        setResolvedViewName(null);
        pendingRequests.delete(configKey);
      }
    };

    createView();

    // No cleanup needed - module-level state persists across unmounts
    // IMPORTANT: Only depend on stable primitive values
    // - Do NOT include `insight` (object reference changes every render)
    // - Do NOT include `isReady` (would create feedback loop when we setIsReady)
    // - `joinsKey` is a serialized representation of `insight.joins`, so we don't need `insight.joins` directly
    // - `connector`/`uploadArrowTable` are stable (set once at bootstrap)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- joinsKey/effectiveParamsKey track insight.joins/overrides changes; connector/uploadArrowTable are stable
  }, [
    connection,
    isInitialized,
    isDuckDBLoading,
    insightId,
    baseTableId,
    joinsKey,
    configKey,
    effectiveParamsKey, // re-run when the cell's override params change
    connector,
    uploadArrowTable,
  ]);

  return {
    /** The DuckDB view name to query (always `insight_view_<insightId>`) */
    viewName,
    /** Whether the view is ready to be queried */
    isReady,
    /** Error message if view creation failed */
    error,
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
