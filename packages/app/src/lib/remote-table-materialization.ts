import {
  addDataFrameEntry,
  getDataTable,
  removeDataFrame,
  updateDataTable,
} from "@dashframe/core";
import { DataFrame, deleteArrowData } from "@dashframe/engine-browser";
import { getFieldSensitivity, type Field, type UUID } from "@dashframe/types";

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
  const existing = await getDataTable(table.id as UUID);
  const fieldsById = new Map(result.fields.map((field) => [field.id, field]));
  const everyColumnIsExplicitlyCleared =
    result.fieldIds.length > 0 &&
    result.fields.length === result.fieldIds.length &&
    fieldsById.size === result.fieldIds.length &&
    result.fieldIds.every((fieldId) => {
      const field = fieldsById.get(fieldId);
      return field !== undefined && getFieldSensitivity(field) === "cleared";
    });
  if (!everyColumnIsExplicitlyCleared) {
    throw new Error(
      "Every remote column must be reviewed and marked safe before local storage",
    );
  }
  const dataFrame = await DataFrame.create(
    decodeBase64ToBytes(result.arrowBuffer),
    result.fieldIds as UUID[],
  );
  let metadataAdded = false;

  try {
    await addDataFrameEntry(dataFrame, {
      name,
      rowCount: result.rowCount,
      columnCount,
    });
    metadataAdded = true;

    await updateDataTable(table.id as UUID, {
      fields: result.fields,
      dataFrameId: dataFrame.id as UUID,
      lastFetchedAt: Date.now(),
    });
  } catch (cause) {
    const cleanupErrors: unknown[] = [];
    if (metadataAdded) {
      await removeDataFrame(dataFrame.id as UUID).catch((cleanupCause) => {
        cleanupErrors.push(cleanupCause);
      });
    }
    await deleteArrowData(dataFrame.storage.key).catch((cleanupCause) => {
      cleanupErrors.push(cleanupCause);
    });
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [cause, ...cleanupErrors],
        "Failed to materialize and clean up the remote table",
      );
    }
    throw cause;
  }

  if (existing?.dataFrameId && existing.dataFrameId !== dataFrame.id) {
    await removeDataFrame(existing.dataFrameId);
  }

  return {
    dataFrameId: dataFrame.id as UUID,
    rowCount: result.rowCount,
    columnCount,
  };
}
