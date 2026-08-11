import type { DuckDBConnection } from "@dashframe/engine-browser";
import {
  DataFrame as BrowserDataFrame,
  deleteArrowData,
  QueryBuilder,
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
  sourceId?: UUID;
  definitionId?: UUID;
  rowCount?: number;
  columnCount?: number;
  analysis?: DataFrameAnalysis | null;
  lastRefreshedAt?: number;
};

/** Metadata-only reference for frames owned by the native server data plane. */
class ServerDataFrame implements DataFrame {
  readonly id: UUID;
  readonly storage: DataFrameJSON["storage"];
  readonly fieldIds: UUID[];
  readonly primaryKey?: string | string[];
  readonly createdAt: number;

  constructor(entry: DataFrameEntry) {
    this.id = entry.id;
    this.storage = entry.storage;
    this.fieldIds = entry.fieldIds;
    this.primaryKey = entry.primaryKey;
    this.createdAt = entry.createdAt;
  }

  load(connection: DuckDBConnection): Promise<QueryBuilder> {
    return Promise.resolve(new QueryBuilder(this, connection));
  }

  toJSON(): DataFrameJSON {
    return {
      id: this.id,
      storage: this.storage,
      fieldIds: this.fieldIds,
      primaryKey: this.primaryKey,
      createdAt: this.createdAt,
    };
  }

  getStorageType(): string {
    return "Server File";
  }
}

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
    sourceId?: UUID;
    definitionId?: UUID;
    rowCount?: number;
    columnCount?: number;
  },
): Promise<UUID> {
  const entry: DataFrameEntry = {
    ...dataFrame.toJSON(),
    ...metadata,
    lastRefreshedAt: Date.now(),
  };
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
  metadata?: {
    rowCount?: number;
    columnCount?: number;
    sourceId?: UUID;
    definitionId?: UUID;
  },
): Promise<void> {
  const oldEntity = await getDataFrameEntry(id);
  const serialization = newDataFrame.toJSON();
  await updateDataFrameEntry(id, {
    storage: serialization.storage,
    fieldIds: serialization.fieldIds,
    primaryKey: serialization.primaryKey,
    createdAt: serialization.createdAt,
    sourceId: metadata?.sourceId,
    definitionId: metadata?.definitionId,
    rowCount: metadata?.rowCount,
    columnCount: metadata?.columnCount,
    analysis: null,
    lastRefreshedAt: Date.now(),
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
): Promise<
  InstanceType<typeof BrowserDataFrame> | ServerDataFrame | undefined
> {
  const entity = await getDataFrameEntry(id);
  if (!entity) return undefined;
  return entity.storage.type === "file"
    ? new ServerDataFrame(entity)
    : BrowserDataFrame.fromJSON(entity);
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
