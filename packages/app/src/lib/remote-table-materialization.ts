import { addDataFrameEntry, getDataFrameEntry, removeDataFrame } from "@/data";
import { getDataTable, updateDataTable } from "@/lib/data-access/data-tables";
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

export class RemoteTableReplacementError extends AggregateError {
  readonly preserveTable = true;
}

async function cleanupCreatedDataFrame(
  dataFrame: InstanceType<typeof DataFrame>,
  metadataAdded: boolean,
): Promise<unknown[]> {
  const cleanupErrors: unknown[] = [];

  try {
    // Keep the metadata entry as a cleanup handle if durable row deletion fails.
    await deleteArrowData(dataFrame.storage.key);
  } catch (cleanupCause) {
    cleanupErrors.push(cleanupCause);
    return cleanupErrors;
  }

  if (metadataAdded) {
    await removeDataFrame(dataFrame.id as UUID).catch((cleanupCause) => {
      cleanupErrors.push(cleanupCause);
    });
  }
  return cleanupErrors;
}

async function removeReplacedDataFrame(frameId: UUID): Promise<void> {
  const frame = await getDataFrameEntry(frameId);
  if (frame?.storage.type !== "indexeddb") {
    await removeDataFrame(frameId);
    return;
  }

  await deleteArrowData(frame.storage.key);
  try {
    await removeDataFrame(frameId);
  } catch (cleanupCause) {
    // The sensitive payload is gone and the replacement is valid. A stale
    // metadata record is safe to leave for a later maintenance pass.
    console.error(
      "[DashFrame] Removed replaced remote rows but not their metadata:",
      cleanupCause,
    );
  }
}

async function restorePreviousTable(
  tableId: UUID,
  previous: {
    dataFrameId: UUID;
    fields: Field[];
    lastFetchedAt?: number;
  },
  replacement: InstanceType<typeof DataFrame>,
  replacementMetadataAdded: boolean,
): Promise<unknown[]> {
  const recoveryErrors: unknown[] = [];
  try {
    await updateDataTable(tableId, {
      fields: previous.fields,
      dataFrameId: previous.dataFrameId,
      ...(previous.lastFetchedAt === undefined
        ? {}
        : { lastFetchedAt: previous.lastFetchedAt }),
    });
  } catch (recoveryCause) {
    recoveryErrors.push(recoveryCause);
    return recoveryErrors;
  }

  recoveryErrors.push(
    ...(await cleanupCreatedDataFrame(replacement, replacementMetadataAdded)),
  );
  return recoveryErrors;
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
    const cleanupErrors = await cleanupCreatedDataFrame(
      dataFrame,
      metadataAdded,
    );
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [cause, ...cleanupErrors],
        "Failed to materialize and clean up the remote table",
      );
    }
    throw cause;
  }

  if (existing?.dataFrameId && existing.dataFrameId !== dataFrame.id) {
    const previousFrameId = existing.dataFrameId;
    try {
      await removeReplacedDataFrame(previousFrameId);
    } catch (cleanupCause) {
      const recoveryErrors = await restorePreviousTable(
        table.id as UUID,
        { ...existing, dataFrameId: previousFrameId },
        dataFrame,
        metadataAdded,
      );
      throw new RemoteTableReplacementError(
        [cleanupCause, ...recoveryErrors],
        "Failed to replace the remote table safely",
      );
    }
  }

  return {
    dataFrameId: dataFrame.id as UUID,
    rowCount: result.rowCount,
    columnCount,
  };
}
