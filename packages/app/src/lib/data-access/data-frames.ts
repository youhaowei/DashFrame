import type {
  DataFrameAnalysis,
  DataFrameJSON,
  Field,
  Metric,
  SourceSchema,
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
  replacement?: {
    expectedDataFrameId: UUID | null;
    name: string;
    table: string;
    sourceSchema: SourceSchema;
    fields: Field[];
    metrics: Metric[];
  },
): Promise<{ dataFrameId: UUID; rowCount: number; columnCount: number }> {
  return getWyStackClient().mutate(api.ingestLocalDataFrame, {
    dataTableId,
    arrowBase64: bytesToBase64(arrowBuffer),
    primaryKey,
    ...(replacement ? { replacement } : {}),
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
  currentInsightResult?: boolean;
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

export async function removeDataFrame(id: UUID): Promise<void> {
  await getWyStackClient().mutate(api.removeDataFrameEntry, { id });
}

export async function clearAllData(): Promise<void> {
  await getWyStackClient().mutate(api.clearAllData, {});
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
