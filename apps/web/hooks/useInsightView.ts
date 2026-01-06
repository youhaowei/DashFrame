import { useDuckDB } from "@/components/providers/DuckDBProvider";
import { getDataFrame, getDataTable } from "@dashframe/core";
import { buildInsightSQL, ensureTableLoaded } from "@dashframe/engine-browser";
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

  // Initialize state from cache if available
  const [viewName, setViewName] = useState<string | null>(cachedViewName);
  const [isReady, setIsReady] = useState(cachedViewName !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (
      !connection ||
      !isInitialized ||
      isDuckDBLoading ||
      !insightId ||
      !baseTableId ||
      !configKey
    ) {
      setIsReady(false);
      setViewName(null);
      return;
    }

    // Check module-level cache first (survives Strict Mode double-invoke)
    const existingViewName = createdViewsCache.get(configKey);
    if (existingViewName) {
      // View already exists, just update state
      setIsReady(true);
      setViewName(existingViewName);
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
          setViewName(cached);
          setIsReady(true);
          pendingRequests.delete(configKey);
          return;
        }

        // Get base table
        const baseTable = await getDataTable(baseTableId);
        if (!baseTable || !baseTable.dataFrameId) {
          setError("Base table not found");
          setIsReady(false);
          pendingRequests.delete(configKey);
          return;
        }

        // Ensure base DataFrame is loaded
        const baseDataFrame = await getDataFrame(baseTable.dataFrameId);
        if (!baseDataFrame) {
          setError("Base DataFrame not found");
          setIsReady(false);
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

        // Load ALL DataFrames into DuckDB in parallel
        await Promise.all(
          dataFramesToLoad.map(({ dataFrame }) =>
            dataFrame ? ensureTableLoaded(dataFrame, connection) : null,
          ),
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
          setIsReady(false);
          pendingRequests.delete(configKey);
          return;
        }

        // Always create a view with unique name based on insight ID
        const newViewName = `insight_view_${insightId.replace(/-/g, "_")}`;
        await connection.query(
          `CREATE OR REPLACE VIEW "${newViewName}" AS ${sql}`,
        );

        // Store in module-level cache (survives Strict Mode and HMR)
        createdViewsCache.set(configKey, newViewName);
        pendingRequests.delete(configKey);

        setViewName(newViewName);
        setIsReady(true);
        setError(null);
      } catch (err) {
        console.error("[useInsightView] Failed to create view:", err);
        setError(err instanceof Error ? err.message : "Failed to create view");
        setIsReady(false);
        pendingRequests.delete(configKey);
      }
    };

    createView();

    // No cleanup needed - module-level state persists across unmounts
    // IMPORTANT: Only depend on stable primitive values
    // - Do NOT include `insight` (object reference changes every render)
    // - Do NOT include `isReady` (would create feedback loop when we setIsReady)
    // - `joinsKey` is a serialized representation of `insight.joins`, so we don't need `insight.joins` directly
    // eslint-disable-next-line react-hooks/exhaustive-deps -- joinsKey tracks insight.joins changes
  }, [
    connection,
    isInitialized,
    isDuckDBLoading,
    insightId,
    baseTableId,
    joinsKey,
    configKey,
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
