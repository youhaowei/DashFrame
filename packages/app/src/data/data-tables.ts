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

import { api } from "../wystack/api";
import { getWyStackClient } from "../wystack/client";

export function useDataTables(dataSourceId?: UUID): UseDataTablesResult {
  const result = useQuery(api.listDataTables, {
    args: { dataSourceId },
  });
  return {
    data: result.data as DataTable[] | undefined,
    error: result.error,
    isError: result.isError,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    refetch: result.refetch,
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
        const { id } = await addMutation.mutateAsync({
          dataSourceId,
          name,
          table,
          options,
        });
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
        await patchArrayMutation.mutateAsync({
          dataTableId,
          kind: "fields",
          mode: "add",
          value: field,
        });
      },
      updateField: async (
        dataTableId: UUID,
        fieldId: UUID,
        updates: Partial<Field>,
      ): Promise<void> => {
        await patchArrayMutation.mutateAsync({
          dataTableId,
          kind: "fields",
          mode: "update",
          itemId: fieldId,
          value: updates,
        });
      },
      deleteField: async (dataTableId: UUID, fieldId: UUID): Promise<void> => {
        await patchArrayMutation.mutateAsync({
          dataTableId,
          kind: "fields",
          mode: "delete",
          itemId: fieldId,
        });
      },
      addMetric: async (dataTableId: UUID, metric: Metric): Promise<void> => {
        await patchArrayMutation.mutateAsync({
          dataTableId,
          kind: "metrics",
          mode: "add",
          value: metric,
        });
      },
      updateMetric: async (
        dataTableId: UUID,
        metricId: UUID,
        updates: Partial<Metric>,
      ): Promise<void> => {
        await patchArrayMutation.mutateAsync({
          dataTableId,
          kind: "metrics",
          mode: "update",
          itemId: metricId,
          value: updates,
        });
      },
      deleteMetric: async (
        dataTableId: UUID,
        metricId: UUID,
      ): Promise<void> => {
        await patchArrayMutation.mutateAsync({
          dataTableId,
          kind: "metrics",
          mode: "delete",
          itemId: metricId,
        });
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
  const { id } = await getWyStackClient().mutate(api.addDataTable, {
    dataSourceId,
    name,
    table,
    options,
  });
  return id;
}

/**
 * Create a DataTable via the `CreateDataTable` command vocabulary — the
 * PRIMITIVE that does NOT auto-inject metrics. Callers are responsible for
 * passing explicit metrics (e.g. the default Count metric for file ingests).
 *
 * Use this instead of `addDataTable` when you want full control over the
 * metrics list — the legacy `addDataTable` mutation silently prepends a Count
 * metric via `withDefaultCountMetric`, which makes the caller's intent
 * invisible. The command vocabulary path puts the metric explicitly in the
 * caller, matching the spec's traceability rule.
 */
export async function createDataTable(args: {
  id: UUID;
  dataSourceId: UUID;
  name: string;
  table: string;
  sourceSchema?: SourceSchema;
  fields?: Field[];
  metrics?: Metric[];
  dataFrameId?: UUID;
}): Promise<UUID> {
  const { id } = await getWyStackClient().mutate(api.createDataTable, args);
  return id as UUID;
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
  const result = await getWyStackClient().query(api.listDataTables, {
    dataSourceId,
  });
  return result as DataTable[];
}

export async function getAllDataTables(): Promise<DataTable[]> {
  const result = await getWyStackClient().query(api.listDataTables, {});
  return result as DataTable[];
}
