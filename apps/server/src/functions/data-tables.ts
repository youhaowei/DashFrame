import type { Field, Metric, SourceSchema } from "@dashframe/types";
import { z } from "zod";

/**
 * Canonical structural contract for the JSONB state stored on a DataTable row.
 * The same schema guards canonical writes and reads, including the nested
 * source-column, field, and metric shapes consumed by downstream code.
 */
const columnTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "date",
  "unknown",
]);

const tableColumnSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    foreignKey: z
      .object({
        tableId: z.string().min(1),
        columnName: z.string().min(1),
      })
      .optional(),
    isIdentifier: z.boolean().optional(),
    isReference: z.boolean().optional(),
  })
  .passthrough();

const sourceSchemaSchema = z
  .object({
    columns: z.array(tableColumnSchema),
    version: z.number().finite(),
    lastSyncedAt: z.number().finite(),
  })
  .passthrough();

const fieldSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    tableId: z.string().min(1),
    columnName: z.string().min(1).optional(),
    type: columnTypeSchema,
    isIdentifier: z.boolean().optional(),
    isReference: z.boolean().optional(),
    sensitivity: z.enum(["unclassified", "sensitive", "cleared"]).optional(),
    sensitivityReason: z.string().optional(),
    sensitivitySource: z.enum(["user", "classifier"]).optional(),
  })
  .passthrough();

const metricSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    tableId: z.string().min(1),
    columnName: z.string().min(1).optional(),
    aggregation: z.enum([
      "sum",
      "avg",
      "count",
      "min",
      "max",
      "count_distinct",
    ]),
  })
  .passthrough();

export const storedDataTableStateSchema = z.object({
  sourceSchema: sourceSchemaSchema
    .nullish()
    .transform((value) => value ?? undefined),
  fields: z
    .array(fieldSchema)
    .nullish()
    .transform((value) => value ?? []),
  metrics: z
    .array(metricSchema)
    .nullish()
    .transform((value) => value ?? []),
});

export interface StoredDataTableState {
  sourceSchema?: SourceSchema;
  fields: Field[];
  metrics: Metric[];
}

export function parseStoredDataTableState(
  value: unknown,
  subject: string,
): StoredDataTableState {
  const parsed = storedDataTableStateSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "state";
    throw new Error(`${subject} is invalid: ${path} ${issue?.message}`);
  }
  return parsed.data as StoredDataTableState;
}
