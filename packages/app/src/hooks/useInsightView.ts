import { useChartEngine } from "@/components/providers/ChartEngineProvider";
import { useDuckDB } from "@/components/providers/DuckDBProvider";
import { getDataFrame, getDataTable } from "@dashframe/core";
import {
  buildInsightSQL,
  ensureTableLoaded,
  loadArrowData,
} from "@dashframe/engine-browser";
import type { DataTable, Insight, UUID } from "@dashframe/types";
import { useEffect, useState } from "react";

// Module-level cache to track which views have been created
// This survives React Strict Mode's double-invoke and HMR remounts
const createdViewsCache = new Map<string, string>(); // configKey -> viewName

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
  for (const [key, viewName] of createdViewsCache.entries()) {
    if (key.startsWith(`${insightId}:`)) {
      return viewName;
    }
  }
  return null;
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
export function useInsightView(insight: Insight | null | undefined) {
  const { connection, isInitialized, isLoading: isDuckDBLoading } = useDuckDB();
  const { connector, uploadArrowTable } = useChartEngine();

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

  // Compute config key for cache lookup
  const configKey = insightId ? `${insightId}:${joinsKey}` : null;

  // Check module-level cache for existing view (survives Strict Mode remounts)
  const cachedViewName = configKey
    ? (createdViewsCache.get(configKey) ?? null)
    : null;

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

    // Capture joins array from insight at effect start (insight may change during async)
    const joins = insight?.joins ?? [];

    const createView = async () => {
      try {
        // Double-check cache in case another effect already created it
        if (createdViewsCache.has(configKey)) {
          const cached = createdViewsCache.get(configKey)!;
          setResolvedViewName(cached);
          setResolvedConfigKey(configKey);
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
        await Promise.all(
          dataFramesToLoad.map(async ({ dataFrame }) => {
            if (!dataFrame) return;
            await ensureTableLoaded(dataFrame, connection);
            // Desktop native path: upload the DataFrame's Arrow buffer so the
            // native engine has the same df_* table the WASM engine has.
            if (uploadArrowTable) {
              // loadArrowData reads the local IndexedDB Arrow buffer by key.
              // Remote-backed storage (s3/r2) has no local buffer to upload —
              // those would need a fetch path the native engine doesn't have
              // yet. Fail loudly rather than building a view whose source table
              // is silently missing from the native engine (→ opaque chart 500).
              if (dataFrame.storage.type !== "indexeddb") {
                throw new Error(
                  `Cannot render this chart on the native engine: DataFrame ${dataFrame.id} uses ${dataFrame.storage.type} storage, which is not yet supported for native chart compute.`,
                );
              }
              const arrowBytes = await loadArrowData(dataFrame.storage.key);
              if (!arrowBytes) {
                throw new Error(
                  `Cannot render this chart: Arrow data for DataFrame ${dataFrame.id} was not found in local storage.`,
                );
              }
              const tableName = `df_${dataFrame.id.replace(/-/g, "_")}`;
              await uploadArrowTable(tableName, arrowBytes);
            }
          }),
        );

        // Build SQL for the model (all columns, no aggregation)
        // Works for both simple insights and those with joins
        // Note: We need insight for buildInsightSQL, but we only run this effect
        // when the relevant primitives (insightId, baseTableId, joinsKey) change
        const sql = buildInsightSQL(
          baseTable,
          joinedTables,
          { joins } as Insight,
          {
            mode: "model",
          },
        );

        if (!sql) {
          setError("Failed to build SQL for insight view");
          setResolvedViewName(null);
          pendingRequests.delete(configKey);
          return;
        }

        // Always create a view with unique name based on insight ID
        const newViewName = `insight_view_${insightId.replace(/-/g, "_")}`;
        const createViewSql = `CREATE OR REPLACE VIEW "${newViewName}" AS ${sql}`;
        await connection.query(createViewSql);

        // Desktop: chart queries run against the native engine, so the view
        // must exist there too (the df_* tables were uploaded above).
        if (connector) {
          await connector.query({ type: "exec", sql: createViewSql });
        }

        // Store in module-level cache (survives Strict Mode and HMR)
        createdViewsCache.set(configKey, newViewName);
        pendingRequests.delete(configKey);

        setResolvedViewName(newViewName);
        setResolvedConfigKey(configKey);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- joinsKey tracks insight.joins changes; connector/uploadArrowTable are stable
  }, [
    connection,
    isInitialized,
    isDuckDBLoading,
    insightId,
    baseTableId,
    joinsKey,
    configKey,
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
  };
}
