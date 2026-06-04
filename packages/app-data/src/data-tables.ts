import type {
  DataTable,
  DataTableMutations,
  Field,
  Metric,
  SourceSchema,
  UseDataTablesResult,
  UUID,
} from "@dashframe/types";
import { useMutation, useQuery } from "@wystack/client";
import { useMemo } from "react";

import { api } from "./api";
import { getWyStackClient } from "./client";
import { loose } from "./wystack-args";

export function useDataTables(dataSourceId?: UUID): UseDataTablesResult {
  const result = useQuery(api.listDataTables, {
    args: loose({ dataSourceId }),
  });
  return {
    data: result.data as DataTable[] | undefined,
    isLoading: result.isLoading,
  };
}

export function useDataTableMutations(): DataTableMutations {
  const addMutation = useMutation(api.addDataTable);
  const updateMutation = useMutation(api.updateDataTable);
  const refreshMutation = useMutation(api.refreshDataTable);
  const removeMutation = useMutation(api.removeDataTable);
  const patchArrayMutation = useMutation(api.patchDataTableArray);

  return useMemo(
    () => ({
      add: async (
        dataSourceId: UUID,
        name: string,
        table: string,
        options?: {
          id?: UUID;
          sourceSchema?: SourceSchema;
          fields?: Field[];
          metrics?: Metric[];
          dataFrameId?: UUID;
        },
      ): Promise<UUID> => {
        const { id } = await addMutation.mutateAsync(
          loose({ dataSourceId, name, table, options }),
        );
        return id;
      },
      update: async (
        id: UUID,
        updates: Partial<Omit<DataTable, "id" | "createdAt" | "dataSourceId">>,
      ): Promise<void> => {
        await updateMutation.mutateAsync({ id, updates });
      },
      refresh: async (id: UUID, dataFrameId: UUID): Promise<void> => {
        await refreshMutation.mutateAsync({ id, dataFrameId });
      },
      remove: async (id: UUID): Promise<void> => {
        await removeMutation.mutateAsync({ id });
      },
      addField: async (dataTableId: UUID, field: Field): Promise<void> => {
        await patchArrayMutation.mutateAsync(
          loose({ dataTableId, kind: "fields", mode: "add", value: field }),
        );
      },
      updateField: async (
        dataTableId: UUID,
        fieldId: UUID,
        updates: Partial<Field>,
      ): Promise<void> => {
        await patchArrayMutation.mutateAsync(
          loose({
            dataTableId,
            kind: "fields",
            mode: "update",
            itemId: fieldId,
            value: updates,
          }),
        );
      },
      deleteField: async (dataTableId: UUID, fieldId: UUID): Promise<void> => {
        await patchArrayMutation.mutateAsync(
          loose({
            dataTableId,
            kind: "fields",
            mode: "delete",
            itemId: fieldId,
          }),
        );
      },
      addMetric: async (dataTableId: UUID, metric: Metric): Promise<void> => {
        await patchArrayMutation.mutateAsync(
          loose({ dataTableId, kind: "metrics", mode: "add", value: metric }),
        );
      },
      updateMetric: async (
        dataTableId: UUID,
        metricId: UUID,
        updates: Partial<Metric>,
      ): Promise<void> => {
        await patchArrayMutation.mutateAsync(
          loose({
            dataTableId,
            kind: "metrics",
            mode: "update",
            itemId: metricId,
            value: updates,
          }),
        );
      },
      deleteMetric: async (
        dataTableId: UUID,
        metricId: UUID,
      ): Promise<void> => {
        await patchArrayMutation.mutateAsync(
          loose({
            dataTableId,
            kind: "metrics",
            mode: "delete",
            itemId: metricId,
          }),
        );
      },
      updateSourceSchema: async (
        dataTableId: UUID,
        sourceSchema: SourceSchema,
      ): Promise<void> => {
        await updateMutation.mutateAsync({
          id: dataTableId,
          updates: { sourceSchema },
        });
      },
    }),
    [
      addMutation,
      patchArrayMutation,
      refreshMutation,
      removeMutation,
      updateMutation,
    ],
  );
}

export async function addDataTable(
  dataSourceId: UUID,
  name: string,
  table: string,
  options?: {
    id?: UUID;
    sourceSchema?: SourceSchema;
    fields?: Field[];
    metrics?: Metric[];
    dataFrameId?: UUID;
  },
): Promise<UUID> {
  const { id } = await getWyStackClient().mutate(
    api.addDataTable,
    loose({ dataSourceId, name, table, options }),
  );
  return id;
}

export async function updateDataTable(
  id: UUID,
  updates: Partial<Omit<DataTable, "id" | "createdAt" | "dataSourceId">>,
): Promise<void> {
  await getWyStackClient().mutate(api.updateDataTable, { id, updates });
}

export async function getDataTable(id: UUID): Promise<DataTable | undefined> {
  const result = await getWyStackClient().query(api.getDataTable, { id });
  return (result as DataTable | null) ?? undefined;
}

export async function getDataTablesBySource(
  dataSourceId: UUID,
): Promise<DataTable[]> {
  const result = await getWyStackClient().query(
    api.listDataTables,
    loose({ dataSourceId }),
  );
  return result as DataTable[];
}

export async function getAllDataTables(): Promise<DataTable[]> {
  const result = await getWyStackClient().query(api.listDataTables, loose({}));
  return result as DataTable[];
}
