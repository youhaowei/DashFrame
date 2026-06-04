import type {
  CreateDataSourceInput,
  DataSource,
  DataSourceMutations,
  UseDataSourcesResult,
  UUID,
} from "@dashframe/types";
import { useMutation, useQuery } from "@wystack/client";
import { useMemo } from "react";

import { api } from "./api";
import { getWyStackClient } from "./client";
import { loose } from "./wystack-args";

export function useDataSources(): UseDataSourcesResult {
  const result = useQuery(api.listDataSources);
  return {
    data: result.data as DataSource[] | undefined,
    isLoading: result.isLoading,
  };
}

export function useDataSourceMutations(): DataSourceMutations {
  const addMutation = useMutation(api.addDataSource);
  const updateMutation = useMutation(api.updateDataSource);
  const removeMutation = useMutation(api.removeDataSource);

  return useMemo(
    () => ({
      add: async (input: CreateDataSourceInput): Promise<UUID> => {
        const { id } = await addMutation.mutateAsync(loose(input));
        return id;
      },
      update: async (
        id: UUID,
        updates: Partial<
          Pick<DataSource, "name" | "apiKey" | "connectionString">
        >,
      ): Promise<void> => {
        await updateMutation.mutateAsync(loose({ id, ...updates }));
      },
      remove: async (id: UUID): Promise<void> => {
        await removeMutation.mutateAsync({ id });
      },
    }),
    [addMutation, removeMutation, updateMutation],
  );
}

export async function addDataSource(
  input: CreateDataSourceInput,
): Promise<UUID> {
  const { id } = await getWyStackClient().mutate(
    api.addDataSource,
    loose(input),
  );
  return id;
}

export async function updateDataSource(
  id: UUID,
  updates: Partial<Pick<DataSource, "name" | "apiKey" | "connectionString">>,
): Promise<void> {
  await getWyStackClient().mutate(
    api.updateDataSource,
    loose({ id, ...updates }),
  );
}

export async function removeDataSource(id: UUID): Promise<void> {
  await getWyStackClient().mutate(api.removeDataSource, { id });
}

export async function getDataSource(id: UUID): Promise<DataSource | undefined> {
  const result = await getWyStackClient().query(api.getDataSource, { id });
  return (result as DataSource | null) ?? undefined;
}

export async function getDataSourceByType(
  type: string,
): Promise<DataSource | null> {
  const result = await getWyStackClient().query(api.getDataSourceByType, {
    type,
  });
  return result as DataSource | null;
}

export async function getAllDataSources(): Promise<DataSource[]> {
  const result = await getWyStackClient().query(api.listDataSources, {});
  return result as DataSource[];
}
