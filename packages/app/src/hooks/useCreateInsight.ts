import { useMutation } from "convex/react";
import { getAllInsights } from "@/lib/data-access/insights";
import { api } from "@dashframe/convex-backend/api";
import { cmd, resultValueByCommandPath, type UUID } from "@dashframe/types";
import { useCallback } from "react";
import { toast } from "sonner";

/**
 * Creates the insight a new chart is built on, without opening it anywhere:
 * the caller shows it where the chart is being made — a chart tab in a report.
 */
export function useCreateInsight() {
  const commitBatch = useMutation(api.app.commitBatch);

  /**
   * Always a fresh row — two new charts on one table must not share an
   * insight — named after the table, with a numeric suffix when that name is
   * taken. It starts EMPTY: with no fields selected the engine reads the raw
   * table, so the new chart tab shows every source row. The caller picks the
   * id, so it can record the chart before the create is sent. Failures toast
   * here and resolve to null.
   */
  const createChartInsight = useCallback(
    async (
      tableId: string,
      tableName: string,
      id: UUID,
    ): Promise<UUID | null> => {
      try {
        const allInsights = await getAllInsights();
        const takenNames = new Set(
          allInsights
            .filter(
              (i) =>
                i.source.sourceType === "dataTable" &&
                i.source.sourceId === tableId,
            )
            .map((i) => i.name),
        );
        let name = tableName;
        let suffix = 2;
        while (takenNames.has(name)) {
          name = `${tableName} (${suffix})`;
          suffix++;
        }
        const command = cmd("CreateInsight", {
          id,
          name,
          source: { sourceType: "dataTable", sourceId: tableId as UUID },
          selectedFields: [],
        });
        const result = await commitBatch({ commands: [command] });
        const value = resultValueByCommandPath(result, command.path) as {
          id?: unknown;
        };
        if (typeof value?.id !== "string") {
          throw new Error("Insight creation returned no id");
        }
        return value.id as UUID;
      } catch (error) {
        console.error("[useCreateInsight] create chart insight failed:", error);
        toast.error("Couldn't start the chart");
        return null;
      }
    },
    [commitBatch],
  );

  return { createChartInsight };
}
