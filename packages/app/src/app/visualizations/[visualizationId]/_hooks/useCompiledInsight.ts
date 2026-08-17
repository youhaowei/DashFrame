import { resolveInsightAuthoringTable } from "@/lib/insights/compute-combined-fields";
import { api } from "@/wystack/api";
import { buildInsightAvailableFields } from "@dashframe/engine";
import type {
  CompiledInsight,
  DataTable,
  Insight,
  UseQueryResult,
  UUID,
} from "@dashframe/types";
import { useQuery } from "@wystack/client";
import { useMemo } from "react";

export function useCompiledInsight(
  id: UUID | undefined,
): UseQueryResult<CompiledInsight | null> {
  const insight = useQuery(api.getInsight, {
    args: { id },
    skip: !id,
  });
  const tables = useQuery(api.listDataTables, {
    args: {},
    skip: !id,
  });
  const insights = useQuery(api.listInsights, {
    args: {},
    skip: !id,
  });

  const compiled = useMemo((): CompiledInsight | null | undefined => {
    if (!id) return null;
    const entity = insight.data as Insight | null | undefined;
    const dataTables = tables.data as DataTable[] | undefined;
    if (entity === undefined || dataTables === undefined) return undefined;
    if (!entity) return null;
    const allInsights = insights.data as Insight[] | undefined;
    if (entity.source.sourceType === "insight" && allInsights === undefined) {
      return undefined;
    }

    const baseTable = resolveInsightAuthoringTable(
      entity,
      dataTables,
      allInsights ?? [],
    );
    if (!baseTable) return null;
    const joinedTables = new Map<UUID, DataTable>();
    for (const join of entity.joins ?? []) {
      const joined = dataTables.find((table) => table.id === join.rightTableId);
      if (joined) joinedTables.set(joined.id, joined);
    }
    const allFields =
      buildInsightAvailableFields(baseTable, joinedTables, entity) ?? [];

    return {
      id: entity.id,
      name: entity.name,
      dimensions: (entity.selectedFields ?? [])
        .map((fieldId) => allFields.find((field) => field.id === fieldId))
        .filter((field): field is NonNullable<typeof field> => Boolean(field)),
      metrics: entity.metrics ?? [],
      filters: entity.filters,
      sorts: entity.sorts,
    };
  }, [id, insight.data, insights.data, tables.data]);

  return {
    data: compiled,
    isLoading:
      Boolean(id) &&
      (compiled === undefined ||
        insight.isLoading ||
        tables.isLoading ||
        insights.isLoading),
  };
}
