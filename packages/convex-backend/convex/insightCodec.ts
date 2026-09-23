import { z } from "zod";
import type {
  InsightSource,
  InsightReporting,
  InsightRuntimeDeclaration,
  UUID,
  InsightMetric,
  InsightFilter,
  InsightSort,
  InsightJoinConfig,
} from "@dashframe/types";
export interface StoredInsightDefinition {
  /** Canonical structural source. Legacy `baseTableId` is normalized away. */
  source: InsightSource;
  selectedFields: UUID[];
  metrics: unknown[];
  filters?: unknown[];
  sorts?: unknown[];
  joins?: unknown[];
  runtimeControls?: InsightRuntimeDeclaration;
  reporting?: InsightReporting;
}

/**
 * Stamp a persisted identity on every filter accepted at an API write boundary.
 *
 * Agent commands and legacy API calls may omit `id`; giving those predicates an
 * id before they reach storage keeps UI identity independent of array order.
 * Filter element validation remains intentionally opaque at this layer, so
 * non-object entries are left for the existing definition contract to handle.
 */
export function ensureInsightFilterIds(filters: unknown[]): unknown[] {
  return filters.map((filter) => {
    if (
      filter !== null &&
      typeof filter === "object" &&
      !Array.isArray(filter) &&
      (!("id" in filter) || typeof filter.id !== "string" || !filter.id)
    ) {
      return { ...filter, id: crypto.randomUUID() };
    }
    return filter;
  });
}

/**
 * The ideal stored-definition write shape (arrays conceptually present, element
 * types known). The encoder emits this and command handlers consume it. Kept
 * hand-written (not `z.infer`) and separate from the tolerant runtime schema so
 * optionality does not ripple into those typed call sites.
 */
export type InsightDefinition = {
  source: InsightSource;
  selectedFields: UUID[];
  metrics: InsightMetric[];
  filters?: InsightFilter[];
  sorts?: InsightSort[];
  joins?: InsightJoinConfig[];
  runtimeControls?: InsightRuntimeDeclaration;
  reporting?: InsightReporting;
};

// ---------------------------------------------------------------------------
// JSONB validation schema (defined once, applied at every read/cast site)
// ---------------------------------------------------------------------------

/**
 * Zod schema for the polymorphic InsightSource stored in
 * `insights.definition`. Validates the discriminant and the required id before
 * any property access so a corrupt/unexpected blob fails with a clear
 * ZodError rather than throwing on `undefined.someField`.
 */
export const insightSourceSchema = z.object({
  sourceType: z.enum(["dataTable", "insight"]),
  sourceId: z.string(),
});

const reportDateRangeSchema = z.union([
  z
    .object({
      type: z.literal("absolute"),
      start: z.string().datetime({ offset: true }),
      end: z.string().datetime({ offset: true }),
    })
    .strict()
    .refine((range) => Date.parse(range.start) <= Date.parse(range.end), {
      message: "Date range start must not follow its end",
    }),
  z
    .object({
      type: z.enum([
        "this_month",
        "previous_month",
        "this_quarter",
        "previous_quarter",
        "this_year",
        "previous_year",
        "month_to_date",
        "year_to_date",
      ]),
    })
    .strict(),
  z
    .object({
      type: z.enum([
        "last_complete_days",
        "last_complete_weeks",
        "last_complete_months",
      ]),
      count: z.number().int().positive().max(10000),
    })
    .strict(),
]);

export const reportingSchema = z
  .object({
    comparison: z.enum(["previous_period", "previous_year"]).optional(),
    measureIds: z.array(z.string().min(1)).min(1).optional(),
    dateRange: z
      .object({ fieldId: z.string().min(1), range: reportDateRangeSchema })
      .strict()
      .optional(),
    dateGrains: z
      .record(z.string(), z.enum(["day", "week", "month", "quarter", "year"]))
      .optional(),
    pivotFields: z.array(z.string()).optional(),
    totals: z.boolean().optional(),
    topN: z
      .object({
        fieldId: z.string(),
        measureId: z.string(),
        count: z.number().int().positive().max(10000),
        direction: z.enum(["asc", "desc"]),
      })
      .optional(),
    limit: z.number().int().positive().max(100000).optional(),
  })
  .strict();

const runtimeSelectionSchema = z
  .object({
    allowedIds: z.array(z.string().min(1)).min(1),
    maxSelected: z.number().int().positive().max(16),
  })
  .strict();

export const runtimeControlsSchema = z
  .object({
    dimensions: runtimeSelectionSchema.optional(),
    measures: runtimeSelectionSchema.optional(),
    filters: z
      .array(
        z
          .object({
            key: z.string().min(1),
            filterId: z.string().min(1),
            label: z.string(),
            required: z.boolean().optional(),
            allowClear: z.boolean().optional(),
          })
          .refine((control) => !(control.required && control.allowClear), {
            message: "a required runtime filter cannot allow clearing",
          }),
      )
      .refine(
        (controls) =>
          new Set(controls.map((control) => control.key)).size ===
            controls.length &&
          new Set(controls.map((control) => control.filterId)).size ===
            controls.length,
      )
      .optional(),
    sort: z
      .object({
        allowedFieldIds: z.array(z.string()),
        maxKeys: z.number().int().min(1).max(1),
      })
      .optional(),
    limit: z
      .object({
        min: z.number().int().positive(),
        max: z.number().int().positive(),
      })
      .refine((value) => value.min <= value.max)
      .optional(),
  })
  .strict();

/**
 * Canonical runtime schema for the `insights.definition` JSONB blob. Applied at
 * every read site — `decodeInsight` here, and `requireInsightDefinition` /
 * `parseRowDefinition` in `commands.ts` — so every reader gets a validated,
 * typed value, not a blindly-cast unknown.
 *
 * Tolerance: `selectedFields`/`metrics` coalesce absent-or-null → `[]`, and
 * `filters`/`sorts`/`joins` absent-or-null → `undefined`. A SQL JSONB column
 * can store `null` for an omitted key, and an auto-draft legitimately omits
 * these; both are "nothing set", not corruption. A present-but-non-array value
 * is still rejected. Element shapes are trusted (`z.unknown()`) — see the
 * module header.
 *
 * Canonical rows carry `source` only. Legacy base-only rows normalize to a
 * DataTable source at this boundary. Rows carrying both fields must agree;
 * disagreement is corruption rather than a precedence rule.
 *
 * Exported so tests can assert parse-call counts (e.g. the orphan scan parses
 * each insight once, not once per owned table).
 */
export const storedInsightDefinitionSchema = z
  .object({
    baseTableId: z.string().optional(),
    source: insightSourceSchema.optional(),
    selectedFields: z
      .array(z.string())
      .nullish()
      .transform((v) => v ?? []),
    metrics: z
      .array(z.unknown())
      .nullish()
      .transform((v) => v ?? []),
    filters: z
      .array(z.unknown())
      .nullish()
      .transform((v) => v ?? undefined),
    sorts: z
      .array(z.unknown())
      .nullish()
      .transform((v) => v ?? undefined),
    joins: z
      .array(z.unknown())
      .nullish()
      .transform((v) => v ?? undefined),
    reporting: reportingSchema.optional(),
    runtimeControls: runtimeControlsSchema
      .nullish()
      .transform((v) => v ?? undefined),
  })
  .superRefine((definition, context) => {
    if (!definition.source && !definition.baseTableId) {
      context.addIssue({
        code: "custom",
        message: "source is required",
        path: ["source"],
      });
    }
    if (
      definition.source &&
      definition.baseTableId &&
      definition.source.sourceId !== definition.baseTableId
    ) {
      context.addIssue({
        code: "custom",
        message: "source.sourceId must match legacy baseTableId",
        path: ["source", "sourceId"],
      });
    }
  })
  .transform(({ baseTableId, source, ...definition }) => ({
    ...definition,
    source:
      source ?? ({ sourceType: "dataTable", sourceId: baseTableId! } as const),
  }));
