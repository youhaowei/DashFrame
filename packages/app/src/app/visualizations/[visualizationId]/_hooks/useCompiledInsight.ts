import { useQuery_experimental as useQuery } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { resolveInsightAuthoringTable } from "@/lib/insights/compute-combined-fields";
import { api } from "@dashframe/convex-backend/api";
import { buildInsightAvailableFields } from "@dashframe/engine";
import type {
  CompiledInsight,
  DataTable,
  Insight,
  UseQueryResult,
  UUID,
} from "@dashframe/types";

import { useMemo } from "react";

export function useCompiledInsight(
  id: UUID | undefined,
): UseQueryResult<CompiledInsight | null> {
  const insight = queryStatus(
    useQuery({ query: api.app.getInsight, args: !id ? "skip" : { id } }),
  );
  const tables = queryStatus(
    useQuery({ query: api.app.listDataTables, args: !id ? "skip" : {} }),
  );
  const insights = queryStatus(
    useQuery({ query: api.app.listInsights, args: !id ? "skip" : {} }),
  );

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
