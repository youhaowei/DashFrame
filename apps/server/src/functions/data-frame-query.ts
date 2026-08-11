/** Closed, bounded reads of project-owned materialized DataFrames. */
import { arrowIpcToJsonRows } from "@dashframe/engine-server";
import { schema } from "@dashframe/server-core";
import type { UUID } from "@dashframe/types";
import { eq, jsonb, uuid } from "@wystack/db";
import { z } from "zod";

import type { DashframeFunctionContext } from "../app-context";
import { permissions } from "../permissions";
import { wy } from "../wystack";

const MAX_PAGE_SIZE = 500;
const MAX_OFFSET = 100_000;

const requestSchema = z.object({
  offset: z.number().int().min(0).max(MAX_OFFSET).optional().default(0),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional().default(100),
  sort: z
    .array(
      z.object({
        fieldId: z.string().min(1),
        direction: z.enum(["asc", "desc"]),
      }),
    )
    .max(5)
    .optional()
    .default([]),
});

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function tableName(id: UUID): string {
  return `df_${id.replaceAll("-", "_")}`;
}

function frameSchema(analysis: unknown, fieldIds: unknown) {
  const ids = Array.isArray(fieldIds)
    ? fieldIds.filter((id): id is string => typeof id === "string")
    : [];
  const fields =
    typeof analysis === "object" &&
    analysis !== null &&
    Array.isArray((analysis as { schema?: unknown }).schema)
      ? (analysis as { schema: unknown[] }).schema.filter(
          (field): field is { id: string; name: string; type: string } =>
            typeof field === "object" &&
            field !== null &&
            typeof (field as { id?: unknown }).id === "string" &&
            typeof (field as { name?: unknown }).name === "string" &&
            typeof (field as { type?: unknown }).type === "string",
        )
      : [];
  const isResultFrame =
    typeof analysis === "object" &&
    analysis !== null &&
    typeof (analysis as { definitionFingerprint?: unknown })
      .definitionFingerprint === "string";
  // The persisted structural ids are the authority. Schema is presentation
  // metadata only, and a malformed row must never widen the ORDER BY surface.
  return {
    ids: new Set(ids),
    schema: fields.filter((field) => ids.includes(field.id)),
    physicalNamesById: new Map(
      fields
        .filter((field) => ids.includes(field.id))
        .map(
          (field) => [field.id, isResultFrame ? field.id : field.name] as const,
        ),
    ),
  };
}

async function ensureRegistered(
  ctx: DashframeFunctionContext,
  id: UUID,
  name: string,
): Promise<void> {
  const runtime = ctx.dataPlaneRuntime;
  if (!runtime?.registerArrowTable || !ctx.dataFrameStorage)
    throw new Error("TARGET_NOT_READY");
  const bytes = await ctx.dataFrameStorage.load(id);
  if (!bytes) throw new Error("FRAME_UNAVAILABLE");
  // Registration is host-owned and idempotent (the native engine atomically
  // replaces the same table). Rehydrate before a read, so a process restart
  // cannot turn a valid persisted frame handle into a caller-visible table id.
  await runtime.registerArrowTable(name, bytes);
}

export const dataFrameQueryFunctions = {
  queryDataFrame: wy.procedure
    .input({
      dataFrameId: uuid,
      offset: jsonb.optional(),
      limit: jsonb.optional(),
      sort: jsonb.optional(),
    })
    .authorize(permissions.data.fetchData)
    .query(async (ctx, input) => {
      const parsed = requestSchema.safeParse({
        offset: input.offset,
        limit: input.limit,
        sort: input.sort,
      });
      if (!parsed.success) {
        return {
          status: "failed" as const,
          code: "QUERY_INVALID_REQUEST",
          message: "The requested page or sort is invalid.",
        };
      }
      const row = (await ctx.db
        .from(schema.dataFrames)
        .where(eq("id", input.dataFrameId))
        .first()) as
        | {
            id: UUID;
            storage: unknown;
            fieldIds: unknown;
            analysis: unknown;
            rowCount: number | null;
          }
        | undefined;
      const storage = row?.storage as
        | { type?: unknown; key?: unknown }
        | undefined;
      if (!row || storage?.type !== "file" || storage.key !== row.id) {
        return {
          status: "failed" as const,
          code: "FRAME_NOT_FOUND",
          message: "The requested DataFrame is unavailable.",
        };
      }
      const structural = frameSchema(row.analysis, row.fieldIds);
      if (structural.ids.size === 0) {
        return {
          status: "failed" as const,
          code: "FRAME_SCHEMA_INVALID",
          message: "The requested DataFrame has no readable schema.",
        };
      }
      if (
        parsed.data.sort.some(
          (key) =>
            !structural.ids.has(key.fieldId) ||
            !structural.physicalNamesById.has(key.fieldId),
        )
      ) {
        return {
          status: "failed" as const,
          code: "QUERY_SORT_NOT_ALLOWED",
          message: "The requested sort field is not in this DataFrame schema.",
        };
      }
      const name = tableName(row.id);
      try {
        await ensureRegistered(ctx, row.id, name);
        const orderBy = parsed.data.sort.length
          ? ` ORDER BY ${parsed.data.sort
              .map(
                (key) =>
                  `${quoteIdentifier(structural.physicalNamesById.get(key.fieldId)!)} ${key.direction.toUpperCase()}`,
              )
              .join(", ")}`
          : "";
        const [pageArrow, countArrow] = await Promise.all([
          ctx.dataPlaneRuntime!.queryArrow(
            `SELECT * FROM ${quoteIdentifier(name)}${orderBy} LIMIT ? OFFSET ?`,
            [parsed.data.limit, parsed.data.offset],
          ),
          ctx.dataPlaneRuntime!.queryArrow(
            `SELECT COUNT(*) AS "count" FROM ${quoteIdentifier(name)}`,
          ),
        ]);
        const rows = arrowIpcToJsonRows(pageArrow);
        const count = arrowIpcToJsonRows(countArrow)[0]?.count;
        const totalCount =
          typeof count === "number" && Number.isFinite(count)
            ? count
            : (row.rowCount ?? 0);
        return {
          status: "ready" as const,
          schema: structural.schema,
          rows,
          totalCount,
          page: {
            offset: parsed.data.offset,
            limit: parsed.data.limit,
            returned: rows.length,
          },
        };
      } catch {
        return {
          status: "failed" as const,
          code: "QUERY_EXECUTION_FAILED",
          message: "The requested DataFrame could not be read.",
        };
      }
    }),
};
