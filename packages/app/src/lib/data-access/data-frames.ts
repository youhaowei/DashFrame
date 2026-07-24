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

import { api } from "../../wystack/api";
import { getWyStackClient } from "../../wystack/client";

export type DataFrameEntry = DataFrameJSON & {
  name: string;
  insightId?: UUID;
  rowCount?: number;
  columnCount?: number;
  analysis?: DataFrameAnalysis;
};

async function deleteArrowDataBestEffort(key: string): Promise<void> {
  try {
    await deleteArrowData(key);
  } catch (error) {
    console.warn("Failed to delete Arrow data", error);
  }
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
  const serialization = newDataFrame.toJSON();
  await updateDataFrameEntry(id, {
    storage: serialization.storage,
    fieldIds: serialization.fieldIds,
    primaryKey: serialization.primaryKey,
    createdAt: serialization.createdAt,
    rowCount: metadata?.rowCount,
    columnCount: metadata?.columnCount,
  });
  if (oldEntity?.storage?.type === "indexeddb") {
    await deleteArrowDataBestEffort(oldEntity.storage.key);
  }
}

export async function removeDataFrame(id: UUID): Promise<void> {
  const entity = await getDataFrameEntry(id);
  await getWyStackClient().mutate(api.removeDataFrameEntry, { id });
  if (entity?.storage?.type === "indexeddb") {
    await deleteArrowDataBestEffort(entity.storage.key);
  }
}

export async function clearAllData(): Promise<void> {
  const entities = await getAllDataFrames();
  await getWyStackClient().mutate(api.clearAllData, {});
  for (const entity of entities) {
    if (entity.storage?.type === "indexeddb") {
      await deleteArrowDataBestEffort(entity.storage.key);
    }
  }
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

export async function getAllDataFrames(): Promise<DataFrameEntry[]> {
  const result = await getWyStackClient().query(api.listDataFrames, {});
  return result as DataFrameEntry[];
}
