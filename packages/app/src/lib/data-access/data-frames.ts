import type { DuckDBConnection } from "@dashframe/engine-browser";
import { QueryBuilder } from "@dashframe/engine-browser";
import type {
  DataFrame,
  DataFrameAnalysis,
  DataFrameJSON,
  UUID,
} from "@dashframe/types";

import { api } from "../../wystack/api";
import { getWyStackClient } from "../../wystack/client";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

/** Connector-specific onboarding for local file bytes. */
export async function ingestLocalDataFrame(
  dataTableId: UUID,
  arrowBuffer: Uint8Array,
  primaryKey?: string | string[],
): Promise<{ dataFrameId: UUID; rowCount: number; columnCount: number }> {
  return getWyStackClient().mutate(api.ingestLocalDataFrame, {
    dataTableId,
    arrowBase64: bytesToBase64(arrowBuffer),
    primaryKey,
  });
}

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

export type DataFramePage =
  | {
      status: "ready";
      schema: readonly { id: UUID; name: string; type: string }[];
      rows: Record<string, unknown>[];
      totalCount: number;
      page: { offset: number; limit: number; returned: number };
    }
  | { status: "failed"; code: string; message: string };

/** Read a bounded page from a server-owned DataFrame handle. */
export async function queryDataFrame(
  dataFrameId: UUID,
  options: {
    offset?: number;
    limit?: number;
    sort?: Array<{ fieldId: UUID; direction: "asc" | "desc" }>;
  } = {},
): Promise<DataFramePage> {
  return (await getWyStackClient().query(api.queryDataFrame, {
    dataFrameId,
    ...options,
  })) as DataFramePage;
}

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
}

export async function removeDataFrame(id: UUID): Promise<void> {
  await getWyStackClient().mutate(api.removeDataFrameEntry, { id });
}

export async function clearAllData(): Promise<void> {
  await getWyStackClient().mutate(api.clearAllData, {});
}

export async function getDataFrame(
  id: UUID,
): Promise<ServerDataFrame | undefined> {
  const entity = await getDataFrameEntry(id);
  if (!entity) return undefined;
  return entity.storage.type === "file"
    ? new ServerDataFrame(entity)
    : undefined;
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
