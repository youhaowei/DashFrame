import {
  getAllInsights,
  getInsight,
  useInsightMutations,
} from "@dashframe/core";
import type { Insight } from "@dashframe/types";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

/**
 * Returns true when an insight is an unmodified auto-draft: no fields selected,
 * no metrics, no filters, no sorts, and no joins. These are safe to reuse
 * rather than accumulate as duplicates.
 */
function isUnmodifiedDraft(insight: Insight): boolean {
  return (
    (insight.selectedFields?.length ?? 0) === 0 &&
    (insight.metrics?.length ?? 0) === 0 &&
    (insight.filters?.length ?? 0) === 0 &&
    (insight.sorts?.length ?? 0) === 0 &&
    (insight.joins?.length ?? 0) === 0
  );
}

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
 * Auto-draft deduplication (createInsightFromTable only):
 * - If an unmodified draft for the same source table already exists, the
 *   server returns it atomically rather than creating a duplicate. Two
 *   concurrent calls for the same table converge on one draft (no TOCTOU race).
 * - If the existing insight(s) have been modified/saved, a new draft is
 *   created with a disambiguating numeric suffix, e.g. "orders (2)".
 *   A prompt would be less disruptive but would interrupt a routine action;
 *   the suffix matches the drive-feel expectation of the app.
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
   * Dedup: the server handles unmodified-draft reuse atomically — if a draft
   * already exists for this table it is returned without a new insert. This
   * hook reads existing insights only to compute a gap-free numeric suffix
   * when the user already has modified insights for the same table.
   */
  const createInsightFromTable = useCallback(
    async (tableId: string, tableName: string) => {
      // Read existing insights for UX-only purpose: compute a suffix name when
      // the user already has modified insights for this table. This read is NOT
      // the authoritative dedup gate — the server closes the TOCTOU race by
      // wrapping the check-and-insert in one transaction.
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
      // When all existing insights for this table are unmodified drafts (or none
      // exist), pass the base name — the server will return the existing draft
      // or create a new one atomically.
      let name = tableName;
      const modifiedInsights = sameTableInsights.filter(
        (i) => !isUnmodifiedDraft(i),
      );
      if (modifiedInsights.length > 0) {
        const existingNames = new Set(sameTableInsights.map((i) => i.name));
        let suffix = 2;
        while (existingNames.has(`${tableName} (${suffix})`)) {
          suffix++;
        }
        name = `${tableName} (${suffix})`;
      }

      // Create (or reuse) a draft insight with empty fields. The server returns
      // the existing unmodified draft atomically when one already exists for
      // this baseTableId — two concurrent calls converge on the same id.
      const insightId = await createInsight(
        name,
        tableId, // baseTableId
        { selectedFields: [] }, // Empty for draft state
      );

      // Navigate to insight page (action hub)
      navigate({ to: `/insights/${insightId}` } as never);

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

      // Create a new insight using the same base table.
      // skipDedup: true — derived insights must always be a fresh row; without
      // this flag the server would silently reuse an existing unmodified draft
      // for the same baseTableId, landing the user on the wrong insight.
      const insightId = await createInsight(
        `${sourceInsightName} (derived)`,
        sourceInsight.baseTableId,
        { selectedFields: [], skipDedup: true },
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
