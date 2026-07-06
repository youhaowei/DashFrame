import {
  getAllInsights,
  getDataTable,
  getInsight,
  useInsightMutations,
} from "@dashframe/core";
import type { UUID } from "@dashframe/types";
import { isUnmodifiedDraft } from "@dashframe/types";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

/**
 * Creates insights and navigates to their pages.
 *
 * Provides two creation methods:
 * 1. `createInsightFromTable` - Start fresh from a data table
 * 2. `createInsightFromInsight` - Chain from an existing insight's DataFrame
 *
 * Table-created insights select the base table's fields up front so the
 * canvas opens with a result table immediately. Derived insights keep the
 * previous empty starting point.
 *
 * Name disambiguation (createInsightFromTable only):
 * - If existing modified insights use the same base table, a new insight gets a
 *   gap-free numeric suffix, e.g. "orders (2)".
 * - Table-created insights are pre-populated with selected fields, so they are
 *   not empty auto-drafts and do not use the server's empty-draft reuse path.
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
  const navigate = useNavigate();
  const { create: createInsight } = useInsightMutations();

  /**
   * Creates a draft insight from a data table and navigates to it.
   *
   * Reads existing insights only to compute a gap-free numeric suffix when the
   * user already has modified insights for the same table.
   */
  const createInsightFromTable = useCallback(
    async (
      tableId: string,
      tableName: string,
      options?: { visualize?: boolean },
    ) => {
      // Read existing insights for UX-only purpose: compute a suffix name when
      // the user already has modified insights for this table.
      const allInsights = await getAllInsights();
      const sameTableInsights = allInsights.filter(
        (i) => i.baseTableId === tableId,
      );

      // One or more modified insights exist for this table — create a new draft
      // with a numeric suffix so the user can distinguish without a modal prompt.
      // Suffix-vs-prompt: suffix is non-blocking and fits the drive-feel of the
      // app; a prompt would interrupt a routine action just to confirm a name.
      //
      // Use the first gap-free suffix to avoid collisions when insights are
      // deleted and re-created (e.g. "orders (2)" deleted → next should be
      // "orders (2)", not "orders (3)").
      //
      // When no modified insight exists for this table, pass the base name.
      let name = tableName;
      const modifiedInsights = sameTableInsights.filter(
        (i) => !isUnmodifiedDraft(i),
      );
      const hasModifiedInsights = modifiedInsights.length > 0;
      if (hasModifiedInsights) {
        // The suffix is computed from a point-in-time client snapshot and is
        // NOT race-protected on the server. Two rapid concurrent clicks on a
        // table that already has a modified insight can both compute the same
        // suffix ("orders (2)") and insert two same-named rows. This is the
        // pre-existing suffix-naming behavior (unchanged by the dedup fix);
        // it's non-destructive (duplicate name, no data loss). Trigger to
        // address if duplicate-named drafts become a reported problem: move
        // suffix assignment server-side inside the transaction.
        const existingNames = new Set(sameTableInsights.map((i) => i.name));
        let suffix = 2;
        while (existingNames.has(`${tableName} (${suffix})`)) {
          suffix++;
        }
        name = `${tableName} (${suffix})`;
      }

      const dataTable = await getDataTable(tableId as UUID);
      const visibleFieldIds =
        dataTable?.fields
          ?.filter((field) => !field.name.startsWith("_"))
          .map((field) => field.id) ?? [];
      const allFieldIds = dataTable?.fields?.map((field) => field.id) ?? [];
      const selectedFields =
        visibleFieldIds.length > 0 ? visibleFieldIds : allFieldIds;

      // Create (or reuse) an insight with the table fields selected.
      //
      // Table-created insights are pre-populated, so the server will insert
      // them even if reuseUnmodifiedDraft is true. Keep the flag tied to the
      // old suffix rule for compatibility with any empty-table fallback.
      const insightId = await createInsight(
        name,
        tableId, // baseTableId
        { selectedFields, reuseUnmodifiedDraft: !hasModifiedInsights },
      );

      // Navigate to insight page (action hub)
      navigate({
        to: `/insights/${insightId}`,
        search: options?.visualize ? { visualize: "true" } : undefined,
      } as never);

      return insightId;
    },
    [navigate, createInsight],
  );

  /**
   * Creates a new insight that chains from an existing insight's DataFrame.
   *
   * The new insight uses the same base table as the source insight,
   * allowing users to build on their previous analysis.
   */
  const createInsightFromInsight = useCallback(
    async (sourceInsightId: string, sourceInsightName: string) => {
      const sourceInsight = await getInsight(sourceInsightId);

      if (!sourceInsight) {
        console.error("Source insight not found:", sourceInsightId);
        return null;
      }

      // Create a new insight using the same base table. Derived insights are an
      // explicit creation intent, so they don't opt into reuseUnmodifiedDraft —
      // each call gets a fresh row rather than being rerouted to an existing
      // unmodified draft for the same baseTableId.
      const insightId = await createInsight(
        `${sourceInsightName} (derived)`,
        sourceInsight.baseTableId,
        { selectedFields: [] },
      );

      // Navigate to new insight
      navigate({ to: `/insights/${insightId}` } as never);

      return insightId;
    },
    [navigate, createInsight],
  );

  return {
    createInsightFromTable,
    createInsightFromInsight,
  };
}
