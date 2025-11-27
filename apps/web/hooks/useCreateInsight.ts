import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useInsightsStore } from "@/lib/stores/insights-store";

/**
 * Creates insights and navigates to their pages.
 *
 * Provides two creation methods:
 * 1. `createInsightFromTable` - Start fresh from a data table
 * 2. `createInsightFromInsight` - Chain from an existing insight's DataFrame
 *
 * Both methods create a draft insight with empty selectedFields and navigate
 * to the insight page (action hub) for further configuration.
 *
 * @example From table (standard flow)
 * ```tsx
 * const { createInsightFromTable } = useCreateInsight();
 *
 * const handleTableClick = (tableId: string, tableName: string) => {
 *   createInsightFromTable(tableId, tableName);
 *   // Automatically navigates to /insights/[id]
 * };
 * ```
 *
 * @example From insight (chaining flow)
 * ```tsx
 * const { createInsightFromInsight } = useCreateInsight();
 *
 * const handleChainInsight = (sourceId: string, sourceName: string) => {
 *   createInsightFromInsight(sourceId, sourceName);
 *   // Creates derived insight and navigates to it
 * };
 * ```
 */
export function useCreateInsight() {
  const router = useRouter();

  /**
   * Creates a draft insight from a data table and navigates to it.
   */
  const createInsightFromTable = useCallback(
    (tableId: string, tableName: string) => {
      // Create draft insight with empty fields (shows preview + suggestions)
      const insightId = useInsightsStore.getState().createDraft(
        tableId,
        tableName,
        [] // Empty fieldIds for draft state
      );

      // Navigate to insight page (action hub)
      router.push(`/insights/${insightId}`);

      return insightId;
    },
    [router]
  );

  /**
   * Creates a new insight that chains from an existing insight's DataFrame.
   *
   * The new insight uses the same base table as the source insight,
   * allowing users to build on their previous analysis.
   */
  const createInsightFromInsight = useCallback(
    (sourceInsightId: string, sourceInsightName: string) => {
      const store = useInsightsStore.getState();
      const sourceInsight = store.getInsight(sourceInsightId);

      if (!sourceInsight) {
        console.error("Source insight not found:", sourceInsightId);
        return null;
      }

      if (!sourceInsight.dataFrameId) {
        console.error("Source insight has no computed DataFrame:", sourceInsightId);
        return null;
      }

      // Create a new insight using the same base table
      const insightId = store.createDraft(
        sourceInsight.baseTable.tableId,
        `${sourceInsightName} (derived)`,
        [] // Empty fieldIds for draft state
      );

      // Link to source insight's DataFrame as starting point
      store.setInsightDataFrame(insightId, sourceInsight.dataFrameId);

      // Navigate to new insight
      router.push(`/insights/${insightId}`);

      return insightId;
    },
    [router]
  );

  return {
    createInsightFromTable,
    createInsightFromInsight,
  };
}
