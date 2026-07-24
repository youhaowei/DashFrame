import { api } from "@/wystack/api";
import type {
  CompiledInsight,
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

  const compiled = useMemo((): CompiledInsight | null | undefined => {
    if (!id) return null;
    const entity = insight.data as Insight | null | undefined;
    const dataTables = tables.data as
      | Array<{ id: UUID; fields?: CompiledInsight["dimensions"] }>
      | undefined;
    if (entity === undefined || dataTables === undefined) return undefined;
    if (!entity) return null;

    const baseTable = dataTables.find(
      (table) => table.id === entity.baseTableId,
    );
    if (!baseTable) return null;
    const allFields = [...(baseTable.fields ?? [])];
    for (const join of entity.joins ?? []) {
      const joined = dataTables.find((table) => table.id === join.rightTableId);
      allFields.push(...(joined?.fields ?? []));
    }

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
  }, [id, insight.data, tables.data]);

  return {
    data: compiled,
    isLoading:
      Boolean(id) &&
      (compiled === undefined || insight.isLoading || tables.isLoading),
  };
}
