import { useMemo } from "react";
import { useInsightsStore } from "@/lib/stores/insights-store";
import {
  useDataFramesStore,
  type DataFrameEntry,
} from "@/lib/stores/dataframes-store";
import type { Insight } from "@/lib/stores/types";

export interface InsightInfo {
  /**
   * Unique insight ID
   */
  id: string;
  /**
   * Display name
   */
  name: string;
  /**
   * Base table ID the insight operates on
   */
  tableId: string;
  /**
   * Number of selected fields in the insight
   */
  fieldCount: number;
  /**
   * Number of computed metrics
   */
  metricCount: number;
  /**
   * Whether this insight has a computed DataFrame result
   */
  hasComputedData: boolean;
  /**
   * Row count from computed DataFrame (if available)
   */
  rowCount?: number;
  /**
   * Reference to the underlying Insight for advanced usage
   */
  insight: Insight;
}

/**
 * Provides insight data formatted for display components.
 *
 * Transforms Zustand store data into a consistent structure
 * that can be used with ItemList or other display components.
 *
 * Can optionally filter to only insights that have computed DataFrames
 * (useful when selecting insights for chaining/joining).
 *
 * @param options.excludeIds - Insight IDs to exclude from the list
 * @param options.withComputedDataOnly - Only return insights with computed DataFrames
 *
 * @example Basic usage
 * ```tsx
 * const { insights } = useInsights();
 *
 * return (
 *   <ItemList
 *     items={insights.map(i => ({
 *       id: i.id,
 *       title: i.name,
 *       subtitle: `${i.rowCount ?? 0} rows • ${i.metricCount} metrics`
 *     }))}
 *     onSelect={handleSelect}
 *   />
 * );
 * ```
 *
 * @example Filter for chaining
 * ```tsx
 * // Only show insights with computed data (can be chained)
 * const { insights } = useInsights({
 *   withComputedDataOnly: true,
 *   excludeIds: [currentInsightId]
 * });
 * ```
 */
export function useInsights(options?: {
  excludeIds?: string[];
  withComputedDataOnly?: boolean;
}) {
  const { excludeIds = [], withComputedDataOnly = false } = options ?? {};

  // Subscribe to store changes (using cached arrays for stable references)
  const allInsights = useInsightsStore((state) => state._cachedInsights);
  const dataFrameEntries = useDataFramesStore((state) => state._cachedEntries);

  const insights = useMemo(() => {
    // Build DataFrame entry lookup map for efficient access
    // DataFrameEntry has insightId directly (not nested under metadata)
    const dfByInsightId = new Map<string, DataFrameEntry>(
      dataFrameEntries
        .filter((entry) => entry.insightId)
        .map((entry) => [entry.insightId!, entry]),
    );

    return allInsights
      .filter((insight) => {
        // Exclude specified IDs
        if (excludeIds.includes(insight.id)) {
          return false;
        }

        // Filter for computed data if requested
        if (withComputedDataOnly) {
          const df = dfByInsightId.get(insight.id);
          return !!df;
        }

        return true;
      })
      .map((insight): InsightInfo => {
        const df = dfByInsightId.get(insight.id);

        return {
          id: insight.id,
          name: insight.name,
          tableId: insight.baseTable.tableId,
          fieldCount: insight.baseTable.selectedFields.length,
          metricCount: insight.metrics.length,
          hasComputedData: !!df,
          rowCount: df?.rowCount,
          insight,
        };
      });
  }, [allInsights, dataFrameEntries, excludeIds, withComputedDataOnly]);

  return {
    insights,
  };
}
