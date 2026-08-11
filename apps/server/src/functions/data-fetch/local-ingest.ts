/** Local connector onboarding: persist uploaded Arrow as a server-owned frame. */
import { inspectArrowIpc } from "@dashframe/engine-server/arrow-data-path";
import { schema } from "@dashframe/server-core";
import type {
  DataFrameStorageLocation,
  Field,
  Metric,
  SourceSchema,
  UUID,
} from "@dashframe/types";
import { eq, jsonb, uuid } from "@wystack/db";
import { and, eq as drizzleEq, isNull } from "drizzle-orm";

import type { DashframeFunctionContext } from "../../app-context";
import { permissions } from "../../permissions";
import { wy } from "../../wystack";

type TableRow = typeof schema.dataTables.$inferSelect;
type SourceRow = typeof schema.dataSources.$inferSelect;
const MAX_LOCAL_ARROW_BYTES = 100 * 1024 * 1024;
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
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_LOCAL_ARROW_BYTES ||
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
  ctx: DashframeFunctionContext,
  dataTableId: UUID,
): Promise<{ table: TableRow; source: SourceRow; fields: Field[] }> {
  const table = (await ctx.db
    .from(schema.dataTables)
    .where(eq("id", dataTableId))
    .first()) as TableRow | undefined;
  if (!table) throw new Error("TARGET_NOT_READY");
  const source = (await ctx.db
    .from(schema.dataSources)
    .where(eq("id", table.dataSourceId))
    .first()) as SourceRow | undefined;
  if (!source || source.kind !== "local") throw new Error("TARGET_NOT_READY");
  if (!Array.isArray(table.fields)) throw new Error("TARGET_NOT_READY");
  return { table, source, fields: table.fields as Field[] };
}

async function ingestLocalFrame(
  ctx: DashframeFunctionContext,
  dataTableId: UUID,
  encodedArrow: unknown,
  encodedPrimaryKey?: unknown,
  encodedReplacement?: unknown,
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

  const frameId = crypto.randomUUID() as UUID;
  const fetchedAt = Date.now();
  try {
    await ctx.dataFrameStorage.save(frameId, arrow);
  } catch (error) {
    // A durable store may fail after its atomic rename (for example while
    // syncing the directory). Remove the unreferenced generation before
    // returning the primary save failure.
    await ctx.dataFrameStorage.delete(frameId).catch((cleanupError) => {
      console.error("Failed to clean up unsaved local frame", cleanupError);
    });
    throw error;
  }
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
      lastRefreshedAt: new Date(fetchedAt),
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
      lastFetchedAt: new Date(fetchedAt),
    };
    const artifactDb = ctx.artifactDb;
    if (!artifactDb) throw new Error("TARGET_NOT_READY");
    const expectedDataFrameId =
      replacement?.expectedDataFrameId ?? table.dataFrameId ?? null;
    await artifactDb.transaction(async (tx) => {
      const updated = await tx
        .update(schema.dataTables)
        .set(tableUpdate)
        .where(
          and(
            drizzleEq(schema.dataTables.id, table.id),
            drizzleEq(schema.dataTables.dataSourceId, source.id),
            expectedDataFrameId === null
              ? isNull(schema.dataTables.dataFrameId)
              : drizzleEq(schema.dataTables.dataFrameId, expectedDataFrameId),
          ),
        )
        .returning({ id: schema.dataTables.id });
      if (updated.length !== 1) {
        throw new Error(
          replacement ? "STALE_LOCAL_REPLACEMENT" : "TARGET_NOT_READY",
        );
      }
      await tx.insert(schema.dataFrames).values(frameRow);
    });
    // The raw ArtifactDb transaction is required for a nullable-pointer CAS.
    // Mirror only committed writes into the request tracker so the app wrapper
    // emits the same reactive invalidations as ordinary tracked mutations.
    ctx.db.tablesWritten.add("data_frames");
    ctx.db.tablesWritten.add("data_tables");
  } catch (error) {
    await ctx.dataFrameStorage.delete(frameId).catch((cleanupError) => {
      console.error("Failed to clean up unpublished local frame", cleanupError);
    });
    throw error;
  }
  return {
    dataFrameId: frameId,
    rowCount: inspected.rowCount,
    columnCount: fields.length,
    fetchedAt,
  };
}

const ingestLocalDataFrame = wy.procedure
  .input({
    dataTableId: uuid,
    arrowBase64: jsonb,
    primaryKey: jsonb.optional(),
    replacement: jsonb.optional(),
  })
  .authorize(permissions.commands.commit)
  .mutation(
    async (ctx, { dataTableId, arrowBase64, primaryKey, replacement }) =>
      ingestLocalFrame(
        ctx,
        dataTableId as UUID,
        arrowBase64,
        primaryKey,
        replacement,
      ),
  );

export const localDataFrameIngestFunctions = { ingestLocalDataFrame };
export { ingestLocalFrame };
