/** Local connector onboarding: persist uploaded Arrow as a server-owned frame. */
import { inspectArrowIpc } from "@dashframe/engine-server/arrow-data-path";
import { schema } from "@dashframe/server-core";
import type { DataFrameStorageLocation, Field, UUID } from "@dashframe/types";
import { eq, jsonb, uuid } from "@wystack/db";

import type { DashframeFunctionContext } from "../../app-context";
import { permissions } from "../../permissions";
import { wy } from "../../wystack";

type TableRow = typeof schema.dataTables.$inferSelect;
type SourceRow = typeof schema.dataSources.$inferSelect;
const MAX_LOCAL_ARROW_BYTES = 100 * 1024 * 1024;

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
) {
  if (!ctx.dataFrameStorage) throw new Error("TARGET_NOT_READY");
  const { table, source, fields } = await preparedLocalTable(ctx, dataTableId);
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
  await ctx.dataFrameStorage.save(frameId, arrow);
  try {
    await ctx.db.transaction(async (tx) => {
      await tx.into(schema.dataFrames).insert({
        id: frameId,
        storage: { type: "file", key: frameId } as DataFrameStorageLocation,
        fieldIds: fields.map((field) => field.id),
        primaryKey,
        name: table.name,
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
      });
      await tx
        .from(schema.dataTables)
        .where(eq("id", table.id))
        .update({ dataFrameId: frameId, lastFetchedAt: new Date(fetchedAt) });
    });
  } catch (error) {
    await ctx.dataFrameStorage.delete(frameId).catch(() => undefined);
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
  })
  .authorize(permissions.commands.commit)
  .mutation(async (ctx, { dataTableId, arrowBase64, primaryKey }) =>
    ingestLocalFrame(ctx, dataTableId as UUID, arrowBase64, primaryKey),
  );

export const localDataFrameIngestFunctions = { ingestLocalDataFrame };
export { ingestLocalFrame };
