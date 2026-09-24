import {
  AGGREGATIONS,
  GRAIN_SCOPES,
  isMeasureContract,
  type Field,
  type Metric,
  type MeasureContract,
  type SourceSchema,
} from "@dashframe/types";
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
    scope: z.enum(GRAIN_SCOPES).optional(),
    isIdentifier: z.boolean().optional(),
    isReference: z.boolean().optional(),
    sensitivity: z.enum(["unclassified", "sensitive", "cleared"]).optional(),
    sensitivityReason: z.string().optional(),
    sensitivitySource: z.enum(["user", "classifier"]).optional(),
  })
  .passthrough();

const aggregationSchema = z.enum(AGGREGATIONS);

// Retain Zod's field-level diagnostics for malformed stored contracts.
// The shared predicate remains the acceptance rule at this boundary.
const measureContractDiagnosticSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("additive"),
      additiveOver: z.array(z.enum(GRAIN_SCOPES)).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("ratio") }).strict(),
  z.object({ kind: z.literal("non-additive") }).strict(),
]);

const measureContractSchema = z
  .unknown()
  .superRefine((value, context) => {
    if (isMeasureContract(value)) return;
    const diagnostic = measureContractDiagnosticSchema.safeParse(value);
    if (!diagnostic.success) {
      for (const issue of diagnostic.error.issues)
        context.addIssue(issue as Parameters<typeof context.addIssue>[0]);
    } else {
      context.addIssue({ code: "custom", message: "Invalid input" });
    }
  })
  .transform((value) => value as MeasureContract);

const metricSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    tableId: z.string().min(1),
    columnName: z.string().min(1).optional(),
    aggregation: aggregationSchema,
    contract: measureContractSchema.optional(),
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
