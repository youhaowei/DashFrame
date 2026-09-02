/** Local connector onboarding: persist uploaded Arrow as a server-owned frame. */
import type { DataFrameStorage } from "@dashframe/engine";
import { inspectArrowIpc } from "@dashframe/engine-server/arrow-data-path";
import type {
  DataFrameStorageLocation,
  Field,
  Metric,
  SourceSchema,
  UUID,
} from "@dashframe/types";
import {
  MAX_LOCAL_ARROW_BYTES,
  localArrowSizeIsAllowed,
} from "@dashframe/types";

import { requireUser, type HostContext } from "./context";
import { createHash } from "node:crypto";
import type { HostMetadata, LocalImportClaim } from "./metadata";

type TableRow = NonNullable<Awaited<ReturnType<HostMetadata["getDataTable"]>>>;
type SourceRow = NonNullable<
  Awaited<ReturnType<HostMetadata["getDataSource"]>>
>;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLUMN_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "date",
  "unknown",
]);
const AGGREGATIONS = new Set([
  "sum",
  "avg",
  "count",
  "min",
  "max",
  "count_distinct",
]);
const FIELD_SENSITIVITIES = new Set(["unclassified", "sensitive", "cleared"]);
const FIELD_SENSITIVITY_SOURCES = new Set(["user", "classifier"]);

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function optionalBoolean(value: unknown) {
  return value === undefined || typeof value === "boolean";
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function decodeArrow(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil((MAX_LOCAL_ARROW_BYTES * 4) / 3) + 4
  ) {
    throw new Error("LOCAL_FRAME_INVALID");
  }
  const bytes = Buffer.from(value, "base64");
  if (
    !localArrowSizeIsAllowed(bytes.byteLength) ||
    bytes.toString("base64") !== value
  ) {
    throw new Error("LOCAL_FRAME_INVALID");
  }
  return bytes;
}

function decodePrimaryKey(
  value: unknown,
  fieldNames: readonly string[],
): string | string[] | null {
  if (value === undefined || value === null) return null;
  const keys = typeof value === "string" ? [value] : value;
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !fieldNames.includes(key) ||
        keys.indexOf(key) !== keys.lastIndexOf(key),
    )
  ) {
    throw new Error("LOCAL_FRAME_INVALID");
  }
  return typeof value === "string" ? value : keys;
}

interface LocalTableReplacement {
  expectedDataFrameId: UUID | null;
  name: string;
  table: string;
  sourceSchema: SourceSchema;
  fields: Field[];
  metrics: Metric[];
}

function decodeReplacement(
  value: unknown,
  dataTableId: UUID,
): LocalTableReplacement | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("LOCAL_FRAME_INVALID");
  }
  const candidate = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(candidate, [
      "expectedDataFrameId",
      "name",
      "table",
      "sourceSchema",
      "fields",
      "metrics",
    ]) ||
    !(
      candidate.expectedDataFrameId === null ||
      (typeof candidate.expectedDataFrameId === "string" &&
        UUID_PATTERN.test(candidate.expectedDataFrameId))
    ) ||
    typeof candidate.name !== "string" ||
    !candidate.name ||
    typeof candidate.table !== "string" ||
    !candidate.table ||
    candidate.sourceSchema === null ||
    typeof candidate.sourceSchema !== "object" ||
    !Array.isArray(candidate.fields) ||
    !Array.isArray(candidate.metrics)
  ) {
    throw new Error("LOCAL_FRAME_INVALID");
  }
  const fields = candidate.fields as unknown[];
  const metrics = candidate.metrics as unknown[];
  const sourceSchema = candidate.sourceSchema as Record<string, unknown>;
  if (
    !hasOnlyKeys(sourceSchema, ["columns", "version", "lastSyncedAt"]) ||
    !Array.isArray(sourceSchema.columns) ||
    typeof sourceSchema.version !== "number" ||
    !Number.isInteger(sourceSchema.version) ||
    sourceSchema.version < 1 ||
    typeof sourceSchema.lastSyncedAt !== "number" ||
    !Number.isFinite(sourceSchema.lastSyncedAt) ||
    sourceSchema.lastSyncedAt < 0 ||
    sourceSchema.columns.some((column) => {
      if (column === null || typeof column !== "object") return true;
      const candidateColumn = column as Record<string, unknown>;
      const foreignKey = candidateColumn.foreignKey;
      return (
        !hasOnlyKeys(candidateColumn, [
          "name",
          "type",
          "foreignKey",
          "isIdentifier",
          "isReference",
        ]) ||
        typeof candidateColumn.name !== "string" ||
        !candidateColumn.name ||
        typeof candidateColumn.type !== "string" ||
        !candidateColumn.type ||
        !optionalBoolean(candidateColumn.isIdentifier) ||
        !optionalBoolean(candidateColumn.isReference) ||
        (foreignKey !== undefined &&
          (foreignKey === null ||
            typeof foreignKey !== "object" ||
            !hasOnlyKeys(foreignKey as Record<string, unknown>, [
              "tableId",
              "columnName",
            ]) ||
            typeof (foreignKey as Record<string, unknown>).tableId !==
              "string" ||
            !UUID_PATTERN.test(
              String((foreignKey as Record<string, unknown>).tableId),
            ) ||
            typeof (foreignKey as Record<string, unknown>).columnName !==
              "string" ||
            !(foreignKey as Record<string, unknown>).columnName))
      );
    }) ||
    fields.length === 0 ||
    fields.some((field) => {
      if (field === null || typeof field !== "object") return true;
      const candidateField = field as Record<string, unknown>;
      return (
        !hasOnlyKeys(candidateField, [
          "id",
          "name",
          "tableId",
          "columnName",
          "type",
          "isIdentifier",
          "isReference",
          "sensitivity",
          "sensitivityReason",
          "sensitivitySource",
        ]) ||
        typeof candidateField.id !== "string" ||
        !UUID_PATTERN.test(candidateField.id) ||
        typeof candidateField.name !== "string" ||
        !candidateField.name ||
        typeof candidateField.columnName !== "string" ||
        !candidateField.columnName ||
        candidateField.tableId !== dataTableId ||
        !COLUMN_TYPES.has(String(candidateField.type)) ||
        !optionalBoolean(candidateField.isIdentifier) ||
        !optionalBoolean(candidateField.isReference) ||
        (candidateField.sensitivity !== undefined &&
          !FIELD_SENSITIVITIES.has(String(candidateField.sensitivity))) ||
        !optionalString(candidateField.sensitivityReason) ||
        (candidateField.sensitivitySource !== undefined &&
          !FIELD_SENSITIVITY_SOURCES.has(
            String(candidateField.sensitivitySource),
          ))
      );
    }) ||
    new Set(fields.map((field) => (field as Record<string, unknown>).id))
      .size !== fields.length ||
    metrics.some((metric) => {
      if (metric === null || typeof metric !== "object") return true;
      const candidateMetric = metric as Record<string, unknown>;
      return (
        !hasOnlyKeys(candidateMetric, [
          "id",
          "name",
          "tableId",
          "columnName",
          "aggregation",
        ]) ||
        typeof candidateMetric.id !== "string" ||
        !UUID_PATTERN.test(candidateMetric.id) ||
        typeof candidateMetric.name !== "string" ||
        !candidateMetric.name ||
        candidateMetric.tableId !== dataTableId ||
        !AGGREGATIONS.has(String(candidateMetric.aggregation))
      );
    }) ||
    new Set(metrics.map((metric) => (metric as Record<string, unknown>).id))
      .size !== metrics.length
  ) {
    throw new Error("LOCAL_FRAME_INVALID");
  }
  const fieldNames = new Set(
    fields.map((field) => (field as Record<string, unknown>).columnName),
  );
  const orderedFieldNames = fields.map(
    (field) => (field as Record<string, unknown>).columnName,
  );
  const sourceColumnNames = sourceSchema.columns.map(
    (column) => (column as Record<string, unknown>).name,
  );
  if (
    new Set(orderedFieldNames).size !== orderedFieldNames.length ||
    new Set(sourceColumnNames).size !== sourceColumnNames.length ||
    sourceColumnNames.length !== orderedFieldNames.length ||
    sourceColumnNames.some((name, index) => name !== orderedFieldNames[index])
  ) {
    throw new Error("LOCAL_FRAME_INVALID");
  }
  if (
    metrics.some((metric) => {
      const candidateMetric = metric as Record<string, unknown>;
      return (
        (candidateMetric.columnName !== undefined &&
          (typeof candidateMetric.columnName !== "string" ||
            !fieldNames.has(candidateMetric.columnName))) ||
        (candidateMetric.aggregation !== "count" &&
          typeof candidateMetric.columnName !== "string")
      );
    })
  ) {
    throw new Error("LOCAL_FRAME_INVALID");
  }
  return candidate as unknown as LocalTableReplacement;
}

async function preparedLocalTable(
  ctx: HostContext,
  dataTableId: UUID,
): Promise<{ table: TableRow; source: SourceRow; fields: Field[] }> {
  const table = (await ctx.metadata.getDataTable(dataTableId)) as
    | TableRow
    | undefined;
  if (!table) throw new Error("TARGET_NOT_READY");
  const source = (await ctx.metadata.getDataSource(table.dataSourceId)) as
    | SourceRow
    | undefined;
  if (!source || source.kind !== "local") throw new Error("TARGET_NOT_READY");
  if (!Array.isArray(table.fields)) throw new Error("TARGET_NOT_READY");
  return { table, source, fields: table.fields as Field[] };
}

async function ingestLocalFrame(
  ctx: HostContext,
  dataTableId: UUID,
  encodedArrow: unknown,
  encodedPrimaryKey?: unknown,
  encodedReplacement?: unknown,
  claim?: LocalImportClaim & { operationId: string; requestHash: string },
) {
  if (!ctx.dataFrameStorage) throw new Error("TARGET_NOT_READY");
  const {
    table,
    source,
    fields: currentFields,
  } = await preparedLocalTable(ctx, dataTableId);
  const replacement = decodeReplacement(encodedReplacement, dataTableId);
  if (
    replacement &&
    (table.dataFrameId ?? null) !== replacement.expectedDataFrameId
  ) {
    throw new Error("STALE_LOCAL_REPLACEMENT");
  }
  const fields = replacement?.fields ?? currentFields;
  const arrow = decodeArrow(encodedArrow);
  const inspected = inspectArrowIpc(arrow);
  const expectedNames = fields.map((field) => field.columnName ?? field.name);
  if (
    inspected.fieldNames.length !== expectedNames.length ||
    inspected.fieldNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error("SOURCE_SCHEMA_CHANGED");
  }
  const primaryKey = decodePrimaryKey(encodedPrimaryKey, expectedNames);

  const frameId = (claim?.frameId ?? crypto.randomUUID()) as UUID;
  const fetchedAt = claim?.fetchedAt ?? Date.now();
  await saveReservedFrame(ctx.dataFrameStorage, frameId, arrow);
  try {
    const frameRow = {
      id: frameId,
      storage: { type: "file", key: frameId } as DataFrameStorageLocation,
      fieldIds: fields.map((field) => field.id),
      primaryKey,
      name: replacement?.name ?? table.name,
      sourceId: source.id,
      definitionId: table.id,
      rowCount: inspected.rowCount,
      columnCount: fields.length,
      analysis: {
        schema: fields.map((field) => ({
          id: field.id,
          name: field.columnName ?? field.name,
          type: field.type,
        })),
        provenance: { connectorKind: "local", bindingVersion: "v1" },
        fetchedAt,
      },
      lastRefreshedAt: fetchedAt,
    };
    const tableUpdate = {
      ...(replacement
        ? {
            name: replacement.name,
            table: replacement.table,
            sourceSchema: replacement.sourceSchema,
            fields: replacement.fields,
            metrics: replacement.metrics,
          }
        : {}),
      dataFrameId: frameId,
      lastFetchedAt: fetchedAt,
    };
    await ctx.metadata.commitImportedFrame({
      ...(claim
        ? { operationId: claim.operationId, requestHash: claim.requestHash }
        : {}),
      dataTableId: table.id,
      dataSourceId: source.id,
      expectedDataFrameId: replacement
        ? replacement.expectedDataFrameId
        : (table.dataFrameId ?? null),
      frameRow,
      tableUpdate,
    });
  } catch (error) {
    // A lost response is not a rollback. Retain bytes while the native outcome
    // is unknown; the same operation can recover its committed result later.
    if (claim) {
      const recovered = await recoverOrCancelFailedImport(ctx, claim, error);
      if (recovered) return recovered;
    }
    throw error;
  }

  return {
    dataFrameId: frameId,
    rowCount: inspected.rowCount,
    columnCount: fields.length,
    fetchedAt,
  };
}

export async function ingestLocalDataFrame(
  ctx: HostContext,
  input: {
    dataTableId: string;
    arrowBase64: unknown;
    primaryKey?: unknown;
    replacement?: unknown;
    operationId?: string;
  },
) {
  requireUser(ctx);
  if (!UUID_PATTERN.test(input.dataTableId))
    throw new Error("LOCAL_FRAME_INVALID");
  const operationId = input.operationId ?? crypto.randomUUID();
  if (!UUID_PATTERN.test(operationId)) throw new Error("LOCAL_FRAME_INVALID");
  const requestHash = createHash("sha256")
    .update(
      stableInput({
        dataTableId: input.dataTableId,
        arrowBase64: input.arrowBase64,
        primaryKey: input.primaryKey ?? null,
        replacement: input.replacement ?? null,
      }),
    )
    .digest("hex");
  return serializeImport(ctx.metadata, operationId, async () => {
    const claim = await ctx.metadata.beginLocalImport({
      operationId,
      requestHash,
    });
    if (claim.status === "complete" && claim.result) return claim.result;
    return ingestLocalFrame(
      ctx,
      input.dataTableId as UUID,
      input.arrowBase64,
      input.primaryKey,
      input.replacement,
      { ...claim, operationId, requestHash },
    );
  });
}

export { ingestLocalFrame };

async function recoverOrCancelFailedImport(
  ctx: HostContext,
  claim: LocalImportClaim & { operationId: string; requestHash: string },
  error: unknown,
): Promise<LocalImportClaim["result"]> {
  const importIdentity = {
    operationId: claim.operationId,
    requestHash: claim.requestHash,
  };
  const recovered = await ctx.metadata
    .getLocalImport(importIdentity)
    .catch(() => null);
  if (recovered?.status === "complete" && recovered.result) {
    return recovered.result;
  }
  if (
    !hasErrorMessage(error, "SOURCE_BINDING_CHANGED") &&
    !hasErrorMessage(error, "STALE_LOCAL_REPLACEMENT")
  ) {
    return null;
  }
  if (await ctx.metadata.cancelLocalImport(importIdentity)) {
    await ctx.cleanupResources?.();
  }
  return null;
}

function hasErrorMessage(error: unknown, expected: string): boolean {
  const seen = new Set<Error>();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (
      current.message === expected ||
      current.message
        .split("\n")
        .some((line) => line.trimEnd().endsWith(`Error: ${expected}`))
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

function stableInput(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableInput).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableInput(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const importQueues = new WeakMap<HostMetadata, Map<string, Promise<unknown>>>();
async function serializeImport<T>(
  metadata: HostMetadata,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  let queues = importQueues.get(metadata);
  if (!queues) {
    queues = new Map();
    importQueues.set(metadata, queues);
  }
  const current = (queues.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(run);
  queues.set(key, current);
  try {
    return await current;
  } finally {
    if (queues.get(key) === current) queues.delete(key);
  }
}

async function saveReservedFrame(
  storage: DataFrameStorage,
  frameId: UUID,
  arrow: Uint8Array,
): Promise<void> {
  // A retried reservation may already own durable bytes. Never overwrite them.
  const existing = await storage.load(frameId);
  if (existing) {
    if (!Buffer.from(existing).equals(arrow))
      throw new Error("LOCAL_FRAME_CONTENT_CONFLICT");
    return;
  }
  await storage.save(frameId, arrow);
}
