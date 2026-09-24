import {
  AGGREGATIONS,
  GRAIN_SCOPES,
  isMeasureContract,
  type Field,
  type Metric,
  type MeasureContract,
  type SourceSchema,
  type TableOrigin,
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

export const tableOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resource") }).strict(),
  z
    .object({
      kind: z.literal("definition"),
      version: z.literal(1),
      presetId: z.string().min(1).optional(),
      definition: z
        .object({
          dimensions: z.array(z.string().min(1)).min(1),
          metrics: z.array(z.string().min(1)).min(1),
          dateRange: z.discriminatedUnion("kind", [
            z
              .object({ kind: z.literal("relative"), months: z.number() })
              .strict(),
            z
              .object({
                kind: z.literal("absolute"),
                start: z.string(),
                end: z.string(),
              })
              .strict(),
          ]),
          grain: z.enum(["day", "week", "month"]),
          filters: z
            .array(
              z.discriminatedUnion("kind", [
                z
                  .object({
                    kind: z.literal("dimension"),
                    field: z.string().min(1),
                    operator: z.enum(["exact", "inList"]),
                    values: z.array(z.string()),
                  })
                  .strict(),
                z
                  .object({
                    kind: z.literal("metric"),
                    field: z.string().min(1),
                    operator: z.literal("greaterThan"),
                    value: z.number(),
                  })
                  .strict(),
              ]),
            )
            .optional(),
        })
        .passthrough(),
    })
    .strict(),
]);

export const storedDataTableStateSchema = z.object({
  origin: tableOriginSchema.nullish().transform((value) => value ?? undefined),
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
  origin?: TableOrigin;
  sourceSchema?: SourceSchema;
  fields: Field[];
  metrics: Metric[];
}

export function parseTableOrigin(value: unknown, subject: string): TableOrigin {
  const parsed = tableOriginSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "origin";
    throw new Error(`${subject} is invalid: ${path} ${issue?.message}`);
  }
  return parsed.data as TableOrigin;
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
