/**
 * Insights row ↔ domain codec, and the canonical stored-definition contract.
 *
 * Pilot for the DTO-codec pattern: validate the `definition` JSONB blob at the
 * read seam (fail-closed on structural corruption) and keep the write encoder
 * co-located. This module OWNS the stored-definition schema/types; the insight
 * command handlers (`commands.ts`) consume them, so there is a single canonical
 * `storedInsightDefinitionSchema` — the read and write paths cannot drift.
 *
 * The load-bearing property is that read and write apply the SAME SCHEMA
 * OBJECT, not two schemas kept in agreement — `requireInsightDefinition` reads
 * through it, `requireDefinitionShape` writes through it, so there is nothing
 * for the two seams to drift between. Copy that property, not this file's
 * layout.
 *
 * Validation is STRUCTURAL, not element-deep: the schema rejects a non-object
 * blob, a missing `baseTableId`, or a non-array where an array is required, but
 * trusts element shapes (metric/filter internals). That matches the write
 * boundary, which stores `filters`/`metrics` as opaque `unknown[]` without
 * validating their elements — a read-side element schema would be stricter than
 * anything the write path enforces.
 */
import { schema } from "@dashframe/server-core";
import type {
  Insight,
  InsightFilter,
  InsightJoinConfig,
  InsightMetric,
  InsightRuntimeDeclaration,
  InsightSort,
  UUID,
} from "@dashframe/types";
import { z } from "zod";

import { tsToMillis } from "./timestamps";

export type InsightRow = typeof schema.insights.$inferSelect;

// ---------------------------------------------------------------------------
// Stored insight-definition contract (owned here; consumed by commands.ts)
// ---------------------------------------------------------------------------

/**
 * The polymorphic source description stored in `insights.definition`.
 * Insight-on-Insight composition rides on `sourceType`.
 */
export interface InsightSource {
  sourceType: "dataTable" | "insight";
  sourceId: UUID;
}

/**
 * The stored `insights.definition` JSONB shape as the command handlers read and
 * spread it. Element arrays are `unknown[]` — opaque at this layer, matching the
 * write boundary. Distinct from {@link InsightDefinition} (the typed write shape
 * the encoder emits).
 */
export interface StoredInsightDefinition {
  /** Structural source id — also surfaced on the `Insight` domain type via `decodeInsight`. */
  baseTableId: UUID;
  /** Polymorphic source description; `baseTableId` mirrors `source.sourceId`. */
  source?: InsightSource;
  selectedFields: UUID[];
  metrics: unknown[];
  filters?: unknown[];
  sorts?: unknown[];
  joins?: unknown[];
  runtimeControls?: InsightRuntimeDeclaration;
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
 * types known). The encoder emits this; `app-artifacts.ts` patch/dedup paths
 * consume it. Kept hand-written (not `z.infer`) and separate from the tolerant
 * runtime schema so optionality doesn't ripple into those typed call sites.
 */
export type InsightDefinition = {
  baseTableId: UUID;
  /** Carried through every write; see {@link encodeInsightDefinition}. */
  source?: InsightSource;
  selectedFields: UUID[];
  metrics: InsightMetric[];
  filters?: InsightFilter[];
  sorts?: InsightSort[];
  joins?: InsightJoinConfig[];
  runtimeControls?: InsightRuntimeDeclaration;
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

export const runtimeControlsSchema = z
  .object({
    filters: z
      .array(
        z.object({
          key: z.string().min(1),
          filterId: z.string().min(1),
          label: z.string(),
          required: z.boolean().optional(),
          allowClear: z.boolean().optional(),
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
 * `baseTableId` is required: canonical writes always set it, so a missing one
 * is genuine corruption, safe to throw. No `.uuid()` — legacy ids may not be
 * RFC-4122.
 *
 * Exported so tests can assert parse-call counts (e.g. the orphan scan parses
 * each insight once, not once per owned table).
 */
export const storedInsightDefinitionSchema = z.object({
  baseTableId: z.string(),
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
  runtimeControls: runtimeControlsSchema
    .nullish()
    .transform((v) => v ?? undefined),
});

/**
 * Decode a DB insight row into its validated **stored** definition — the shape
 * that still carries `source`. Throws (fail-closed) on structural corruption,
 * naming the offending insight id.
 *
 * Write handlers must rebuild `definition` from THIS, not from the domain
 * {@link Insight}: `Insight` deliberately omits `source` (it is storage-level
 * composition wiring, not a domain field), so a write reconstructed from a
 * decoded `Insight` silently erases it — which in turn makes a composed insight
 * look like a leaf to the cycle checker in `commands.ts`.
 */
export function decodeStoredInsightDefinition(
  row: InsightRow,
): StoredInsightDefinition {
  const parsed = storedInsightDefinitionSchema.safeParse(row.definition);
  if (!parsed.success) {
    throw new Error(
      `Insight ${row.id} has an invalid definition: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/** Pure projection: no parse, no DB, no throw. */
export function toInsight(
  row: InsightRow,
  definition: StoredInsightDefinition,
): Insight {
  return {
    id: row.id,
    name: row.name,
    baseTableId: definition.baseTableId,
    selectedFields: definition.selectedFields,
    metrics: definition.metrics as InsightMetric[],
    filters: definition.filters as InsightFilter[] | undefined,
    sorts: definition.sorts as InsightSort[] | undefined,
    joins: definition.joins as InsightJoinConfig[] | undefined,
    runtimeControls: definition.runtimeControls,
    createdAt: tsToMillis(row.createdAt),
    updatedAt: row.updatedAt?.getTime(),
  };
}

/**
 * Decode a DB insight row into the domain `Insight`. Throws (fail-closed) when
 * the `definition` blob is structurally invalid — a non-object, a missing
 * `baseTableId`, or a non-array where an array is required — naming the
 * offending insight id. A throw here fails the whole `listInsights` query
 * (the settled fail-closed blast radius). Element shapes are trusted (see the
 * module header); valid-path output is identical to the former `rowToInsight`.
 */
export function decodeInsight(row: InsightRow): Insight {
  return toInsight(row, decodeStoredInsightDefinition(row));
}

/**
 * Encode domain insight fields into the stored `definition` JSONB blob.
 * Symmetric write seam for `decodeInsight`.
 *
 * This function does NOT validate — it only assembles. Callers whose inputs
 * came off the wire (an opaque `jsonb` operand, an untyped patch) must wrap the
 * result in `storedInsightDefinitionSchema.parse(...)` before writing; a
 * non-array that reaches the column mints a row the fail-closed read path can
 * never decode, which fails `listInsights` for EVERY row, not just that one.
 * Assembling and validating are kept separate because some callers already hold
 * a parsed definition and would otherwise pay a redundant parse.
 *
 * `source` has no counterpart on the domain `Insight`, so every caller must
 * source it from {@link decodeStoredInsightDefinition} and pass it through
 * explicitly. Omitting it writes a source-less definition — correct only when
 * the insight genuinely has no source.
 */
export function encodeInsightDefinition(input: {
  baseTableId: UUID;
  source?: InsightSource;
  selectedFields?: UUID[];
  metrics?: InsightMetric[];
  filters?: InsightFilter[];
  sorts?: InsightSort[];
  joins?: InsightJoinConfig[];
  runtimeControls?: InsightRuntimeDeclaration;
}): InsightDefinition {
  return {
    baseTableId: input.baseTableId,
    source: input.source,
    selectedFields: input.selectedFields ?? [],
    metrics: input.metrics ?? [],
    filters: input.filters,
    sorts: input.sorts,
    joins: input.joins,
    runtimeControls: input.runtimeControls,
  };
}
