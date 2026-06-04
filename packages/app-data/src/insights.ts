import type {
  CompiledInsight,
  Insight,
  InsightMetric,
  InsightMutations,
  UseQueryResult,
  UUID,
} from "@dashframe/types";
import { useMutation, useQuery } from "@wystack/client";
import { useMemo } from "react";

import { api } from "./api";
import { getWyStackClient } from "./client";
import { loose } from "./wystack-args";

export function useInsights(options?: {
  excludeIds?: UUID[];
}): UseQueryResult<Insight[]> {
  const result = useQuery(api.listInsights, {
    args: loose({ excludeIds: options?.excludeIds }),
  });
  return {
    data: result.data as Insight[] | undefined,
    isLoading: result.isLoading,
  };
}

export function useInsightMutations(): InsightMutations {
  const createMutation = useMutation(api.createInsight);
  const updateMutation = useMutation(api.updateInsight);
  const removeMutation = useMutation(api.removeInsight);
  const patchMutation = useMutation(api.patchInsight);

  return useMemo(
    () => ({
      create: async (
        name: string,
        baseTableId: UUID,
        options?: { selectedFields?: UUID[]; metrics?: InsightMetric[] },
      ): Promise<UUID> => {
        const { id } = await createMutation.mutateAsync(
          loose({ name, baseTableId, options }),
        );
        return id;
      },
      update: async (
        id: UUID,
        updates: Partial<Omit<Insight, "id" | "createdAt">>,
      ): Promise<void> => {
        await updateMutation.mutateAsync({ id, updates });
      },
      remove: async (id: UUID): Promise<void> => {
        await removeMutation.mutateAsync({ id });
      },
      addField: async (insightId: UUID, fieldId: UUID): Promise<void> => {
        await patchMutation.mutateAsync(
          loose({ id: insightId, mode: "addField", fieldId }),
        );
      },
      removeField: async (insightId: UUID, fieldId: UUID): Promise<void> => {
        await patchMutation.mutateAsync(
          loose({ id: insightId, mode: "removeField", fieldId }),
        );
      },
      addMetric: async (
        insightId: UUID,
        metric: InsightMetric,
      ): Promise<void> => {
        await patchMutation.mutateAsync(
          loose({ id: insightId, mode: "addMetric", metric }),
        );
      },
      updateMetric: async (
        insightId: UUID,
        metricId: UUID,
        updates: Partial<InsightMetric>,
      ): Promise<void> => {
        await patchMutation.mutateAsync(
          loose({ id: insightId, mode: "updateMetric", metricId, updates }),
        );
      },
      removeMetric: async (insightId: UUID, metricId: UUID): Promise<void> => {
        await patchMutation.mutateAsync(
          loose({ id: insightId, mode: "removeMetric", metricId }),
        );
      },
    }),
    [createMutation, patchMutation, removeMutation, updateMutation],
  );
}

export function useInsight(id: UUID): UseQueryResult<Insight | null> {
  const result = useQuery(api.getInsight, { args: { id } });
  return {
    data: (result.data as Insight | null | undefined) ?? null,
    isLoading: result.isLoading,
  };
}

export function useCompiledInsight(
  id: UUID | undefined,
): UseQueryResult<CompiledInsight | null> {
  const insight = useQuery(api.getInsight, {
    args: loose({ id }),
    skip: !id,
  });
  const tables = useQuery(api.listDataTables, { args: loose({}) });

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
    isLoading: compiled === undefined || insight.isLoading || tables.isLoading,
  };
}

export async function getInsight(id: UUID): Promise<Insight | undefined> {
  const result = await getWyStackClient().query(api.getInsight, { id });
  return (result as Insight | null) ?? undefined;
}

export async function getAllInsights(): Promise<Insight[]> {
  const result = await getWyStackClient().query(api.listInsights, loose({}));
  return result as Insight[];
}
