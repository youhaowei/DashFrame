import {
  getAllInsights,
  getInsight,
  useInsightMutations,
} from "@dashframe/core";
import { isUnmodifiedDraft } from "@dashframe/types";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { toast } from "sonner";

/**
 * Creates insights and navigates to their pages.
 *
 * Provides two creation methods:
 * 1. `createInsightFromTable` - Start fresh from a data table
 * 2. `createInsightFromInsight` - Chain from an existing insight's DataFrame
 *
 * Both methods create a draft insight with empty selectedFields and navigate
 * to the insight page. The canvas still opens with a populated result table:
 * an unconfigured insight's query falls back to the raw base table, and
 * pre-selecting every field would instead run query mode with all fields as
 * GROUP BY dimensions — silently collapsing duplicate source rows.
 *
 * Auto-draft deduplication (createInsightFromTable only):
 * - If an unmodified draft for the same source table already exists, the
 *   server returns it atomically rather than creating a duplicate. Two
 *   concurrent calls for the same table converge on one draft (no TOCTOU race).
 * - If the existing insight(s) have been modified/saved, a new draft is
 *   created with a disambiguating numeric suffix, e.g. "orders (2)".
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
   *
   * Raw path — the exported createInsightFromTable wrapper owns error
   * handling (toast + null return) for every call site.
   */
  const createFromTable = useCallback(
    async (
      tableId: string,
      tableName: string,
      options?: { visualize?: boolean },
    ) => {
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

      // Create (or atomically reuse) an EMPTY draft. Empty selectedFields is
      // load-bearing twice over:
      // - the server's unmodified-draft reuse gate only matches empty drafts,
      //   so concurrent creates for the same table converge on one row;
      // - the engine's unconfigured query falls back to the raw base table,
      //   so the canvas shows every source row. Pre-selecting all fields would
      //   run query mode with the fields as GROUP BY dimensions and silently
      //   collapse duplicate rows.
      const insightId = await createInsight(
        name,
        tableId, // baseTableId
        { selectedFields: [], reuseUnmodifiedDraft: !hasModifiedInsights },
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
  const createFromInsight = useCallback(
    async (
      sourceInsightId: string,
      sourceInsightName: string,
      options?: { visualize?: boolean },
    ) => {
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
      navigate({
        to: `/insights/${insightId}`,
        search: options?.visualize ? { visualize: "true" } : undefined,
      } as never);

      return insightId;
    },
    [navigate, createInsight],
  );

  /**
   * Public entry point — createFromTable with failures surfaced at this
   * creation boundary. Call sites invoke it fire-and-forget from click
   * handlers, so a rejection here (table deleted, server down) would
   * otherwise be an unhandled rejection with zero user feedback.
   */
  const createInsightFromTable = useCallback(
    async (
      tableId: string,
      tableName: string,
      options?: { visualize?: boolean },
    ) => {
      try {
        return await createFromTable(tableId, tableName, options);
      } catch (error) {
        console.error("[useCreateInsight] create from table failed:", error);
        toast.error("Couldn't create insight");
        return null;
      }
    },
    [createFromTable],
  );

  /**
   * Creates a new insight that chains from an existing insight's DataFrame.
   *
   * The new insight uses the same base table as the source insight,
   * allowing users to build on their previous analysis.
   *
   * Same boundary rule as createInsightFromTable: failures toast here.
   */
  const createInsightFromInsight = useCallback(
    async (
      sourceInsightId: string,
      sourceInsightName: string,
      options?: { visualize?: boolean },
    ) => {
      try {
        return await createFromInsight(sourceInsightId, sourceInsightName, options);
      } catch (error) {
        console.error("[useCreateInsight] create from insight failed:", error);
        toast.error("Couldn't create insight");
        return null;
      }
    },
    [createFromInsight],
  );

  return {
    createInsightFromTable,
    createInsightFromInsight,
  };
}
