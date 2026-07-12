import {
  addDataFrameEntry,
  getDataTable,
  replaceDataFrame,
  updateDataTable,
} from "@dashframe/core";
import { DataFrame } from "@dashframe/engine-browser";
import type { Field, UUID } from "@dashframe/types";

export interface RemoteQueryResult {
  arrowBuffer: string;
  fieldIds: string[];
  fields: Field[];
  rowCount: number;
}

export interface MaterializedRemoteTable {
  dataFrameId: UUID;
  rowCount: number;
  columnCount: number;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Persist a server-returned Arrow result and link it to its DataTable. */
export async function materializeRemoteTable(
  table: { id: string },
  result: RemoteQueryResult,
  name: string,
): Promise<MaterializedRemoteTable> {
  const columnCount = result.fieldIds.length;
  const dataFrame = await DataFrame.create(
    decodeBase64ToBytes(result.arrowBuffer),
    result.fieldIds as UUID[],
  );
  const existing = await getDataTable(table.id as UUID);
  let dataFrameId: UUID;

  if (existing?.dataFrameId) {
    await replaceDataFrame(existing.dataFrameId, dataFrame, {
      rowCount: result.rowCount,
      columnCount,
    });
    dataFrameId = existing.dataFrameId;
  } else {
    await addDataFrameEntry(dataFrame, {
      name,
      rowCount: result.rowCount,
      columnCount,
    });
    dataFrameId = dataFrame.id as UUID;
  }

  await updateDataTable(table.id as UUID, {
    fields: result.fields,
    dataFrameId,
    lastFetchedAt: Date.now(),
  });

  return { dataFrameId, rowCount: result.rowCount, columnCount };
}
