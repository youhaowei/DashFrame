import { getInsight, useInsightMutations } from "@dashframe/core";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * Creates insights and navigates to their pages.
 *
 * Uses Dexie (IndexedDB) for persistence via core-dexie hooks.
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
  const { create: createInsight } = useInsightMutations();

  /**
   * Creates a draft insight from a data table and navigates to it.
   */
  const createInsightFromTable = useCallback(
    async (tableId: string, tableName: string) => {
      // Create draft insight with empty fields (shows preview + suggestions)
      // Uses Dexie mutation which stores in IndexedDB
      const insightId = await createInsight(
        tableName, // name
        tableId, // baseTableId
        { selectedFields: [] }, // Empty for draft state
      );

      // Navigate to insight page (action hub)
      router.push(`/insights/${insightId}`);

      return insightId;
    },
    [router, createInsight],
  );

  /**
   * Creates a new insight that chains from an existing insight's DataFrame.
   *
   * The new insight uses the same base table as the source insight,
   * allowing users to build on their previous analysis.
   */
  const createInsightFromInsight = useCallback(
    async (sourceInsightId: string, sourceInsightName: string) => {
      // Fetch source insight from Dexie
      const sourceInsight = await getInsight(sourceInsightId);

      if (!sourceInsight) {
        console.error("Source insight not found:", sourceInsightId);
        return null;
      }

      // Create a new insight using the same base table
      const insightId = await createInsight(
        `${sourceInsightName} (derived)`,
        sourceInsight.baseTableId,
        { selectedFields: [] }, // Empty for draft state
      );

      // Navigate to new insight
      router.push(`/insights/${insightId}`);

      return insightId;
    },
    [router, createInsight],
  );

  return {
    createInsightFromTable,
    createInsightFromInsight,
  };
}
