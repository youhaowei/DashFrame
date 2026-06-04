import {
  DataFrame as BrowserDataFrame,
  deleteArrowData,
} from "@dashframe/engine-browser";
import type {
  DataFrame,
  DataFrameAnalysis,
  DataFrameJSON,
  UUID,
} from "@dashframe/types";
import { useMutation, useQuery } from "@wystack/client";
import { useMemo } from "react";

import { api } from "./api";
import { getWyStackClient } from "./client";

export type DataFrameEntry = DataFrameJSON & {
  name: string;
  insightId?: UUID;
  rowCount?: number;
  columnCount?: number;
  analysis?: DataFrameAnalysis;
};

export interface UseDataFramesResult {
  data: DataFrameEntry[] | undefined;
  isLoading: boolean;
}

export interface DataFrameMutations {
  addDataFrame: (
    dataFrame: DataFrame,
    metadata: {
      name: string;
      insightId?: UUID;
      rowCount?: number;
      columnCount?: number;
    },
  ) => Promise<UUID>;
  getEntry: (id: UUID) => Promise<DataFrameEntry | undefined>;
  getByInsight: (insightId: UUID) => Promise<DataFrameEntry | undefined>;
  updateMetadata: (
    id: UUID,
    updates: Partial<
      Pick<DataFrameEntry, "name" | "insightId" | "rowCount" | "columnCount">
    >,
  ) => Promise<void>;
  replaceDataFrame: (
    id: UUID,
    newDataFrame: DataFrame,
    metadata?: { rowCount?: number; columnCount?: number },
  ) => Promise<void>;
  removeDataFrame: (id: UUID) => Promise<void>;
  clear: () => Promise<void>;
  updateAnalysis: (id: UUID, analysis: DataFrameAnalysis) => Promise<void>;
}

export function useDataFrames(): UseDataFramesResult {
  const result = useQuery(api.listDataFrames);
  return {
    data: result.data as DataFrameEntry[] | undefined,
    isLoading: result.isLoading,
  };
}

export function useDataFrameMutations(): DataFrameMutations {
  const putMutation = useMutation(api.putDataFrameEntry);
  const updateMutation = useMutation(api.updateDataFrameEntry);

  return useMemo(
    () => ({
      addDataFrame: async (
        dataFrame: DataFrame,
        metadata: {
          name: string;
          insightId?: UUID;
          rowCount?: number;
          columnCount?: number;
        },
      ): Promise<UUID> => {
        const serialization = dataFrame.toJSON();
        const entry: DataFrameEntry = { ...serialization, ...metadata };
        await putMutation.mutateAsync({ entry });
        return dataFrame.id;
      },
      getEntry: getDataFrameEntry,
      getByInsight: getDataFrameByInsight,
      updateMetadata,
      replaceDataFrame,
      removeDataFrame,
      clear: async (): Promise<void> => {
        await clearAllData();
      },
      updateAnalysis: async (
        id: UUID,
        analysis: DataFrameAnalysis,
      ): Promise<void> => {
        await updateMutation.mutateAsync({ id, updates: { analysis } });
      },
    }),
    [putMutation, updateMutation],
  );
}

export async function addDataFrameEntry(
  dataFrame: DataFrame,
  metadata: {
    name: string;
    insightId?: UUID;
    rowCount?: number;
    columnCount?: number;
  },
): Promise<UUID> {
  const entry: DataFrameEntry = { ...dataFrame.toJSON(), ...metadata };
  await getWyStackClient().mutate(api.putDataFrameEntry, { entry });
  return dataFrame.id;
}

export async function updateDataFrameEntry(
  id: UUID,
  updates: Partial<DataFrameEntry>,
): Promise<void> {
  await getWyStackClient().mutate(api.updateDataFrameEntry, { id, updates });
}

export async function replaceDataFrame(
  id: UUID,
  newDataFrame: DataFrame,
  metadata?: { rowCount?: number; columnCount?: number },
): Promise<void> {
  const oldEntity = await getDataFrameEntry(id);
  if (oldEntity?.storage?.type === "indexeddb") {
    await deleteArrowData(oldEntity.storage.key);
  }
  const serialization = newDataFrame.toJSON();
  await updateDataFrameEntry(id, {
    storage: serialization.storage,
    fieldIds: serialization.fieldIds,
    primaryKey: serialization.primaryKey,
    createdAt: serialization.createdAt,
    rowCount: metadata?.rowCount,
    columnCount: metadata?.columnCount,
  });
}

export async function removeDataFrame(id: UUID): Promise<void> {
  const entity = await getDataFrameEntry(id);
  if (entity?.storage?.type === "indexeddb") {
    await deleteArrowData(entity.storage.key);
  }
  await getWyStackClient().mutate(api.removeDataFrameEntry, { id });
}

export async function clearAllData(): Promise<void> {
  const entities = await getAllDataFrames();
  for (const entity of entities) {
    if (entity.storage?.type === "indexeddb") {
      await deleteArrowData(entity.storage.key);
    }
  }
  await getWyStackClient().mutate(api.clearAllData, {});
}

export async function updateMetadata(
  id: UUID,
  updates: Partial<
    Pick<DataFrameEntry, "name" | "insightId" | "rowCount" | "columnCount">
  >,
): Promise<void> {
  await updateDataFrameEntry(id, updates);
}

export async function updateDataFrameAnalysis(
  id: UUID,
  analysis: DataFrameAnalysis,
): Promise<void> {
  await updateDataFrameEntry(id, { analysis });
}

export async function getDataFrame(
  id: UUID,
): Promise<InstanceType<typeof BrowserDataFrame> | undefined> {
  const entity = await getDataFrameEntry(id);
  return entity ? BrowserDataFrame.fromJSON(entity) : undefined;
}

export async function getDataFrameEntry(
  id: UUID,
): Promise<DataFrameEntry | undefined> {
  const result = await getWyStackClient().query(api.getDataFrameEntry, { id });
  return (result as DataFrameEntry | null) ?? undefined;
}

export async function getDataFrameByInsight(
  insightId: UUID,
): Promise<DataFrameEntry | undefined> {
  const result = await getWyStackClient().query(api.getDataFrameByInsight, {
    insightId,
  });
  return (result as DataFrameEntry | null) ?? undefined;
}

export async function getAllDataFrames(): Promise<DataFrameEntry[]> {
  const result = await getWyStackClient().query(api.listDataFrames, {});
  return result as DataFrameEntry[];
}
