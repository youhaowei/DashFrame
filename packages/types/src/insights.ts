import type { Field } from "./field";
import type { InsightMetric } from "./metric";
import type { UUID } from "./uuid";

// ============================================================================
// Insight Types
// ============================================================================

/**
 * Filter predicate for insights.
 *
 * `field` is the source column name (matches `Field.columnName ?? Field.name`).
 *
 * Operator notes:
 * - `between`: inclusive range check. `value` must be `{ low: unknown; high: unknown }`.
 *   Use this for date ranges and numeric ranges — a single filter, not two.
 * - `in`: membership check. `value` must be an array.
 * - All other operators: `value` is a scalar.
 */
export interface InsightFilter {
  /**
   * Stable identity for a filter predicate. Optional because filters created
   * via the API/agent path may omit it; the UI generates one on add and
   * preserves it across persistence round-trips so concurrent subscription
   * updates can't misroute an in-flight edit to the wrong predicate.
   */
  id?: string;
  field: string;
  operator:
    | "eq"
    | "ne"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "contains"
    | "in"
    | "between";
  value: unknown;
}

/** Value shape for the `between` operator — inclusive on both bounds. */
export interface InsightFilterBetweenValue {
  low: unknown;
  high: unknown;
}

/**
 * Sort order for insights.
 */
export interface InsightSort {
  field: string;
  direction: "asc" | "desc";
}

/**
 * Join configuration for insights.
 * Simple single-key joins. Complex conditions can be added later if needed.
 */
export interface InsightJoinConfig {
  type: "inner" | "left" | "right" | "full";
  rightTableId: UUID;
  leftKey: string;
  rightKey: string;
}

/**
 * Insight - A configured data view/query.
 *
 * Insights define:
 * - Which table to query
 * - Which fields to include
 * - Which metrics to compute
 * - Filters, sorts, joins
 *
 * Results compute live/on-demand via DuckDB. Successful runs may durably
 * materialize immutable frames, but there is no completed-result reuse cache.
 */
export interface Insight {
  id: UUID;
  name: string;
  /** Base table for the insight */
  baseTableId: UUID;
  /** Selected field IDs */
  selectedFields: UUID[];
  /** Metrics to compute */
  metrics: InsightMetric[];
  /** Optional filters */
  filters?: InsightFilter[];
  /** Optional sorts */
  sorts?: InsightSort[];
  /** Optional joins */
  joins?: InsightJoinConfig[];
  /** Explicit, saved runtime surface. Omitted means the Insight is immutable at run time. */
  runtimeControls?: InsightRuntimeDeclaration;
  createdAt: number;
  updatedAt?: number;
}

/** A client-safe, unsaved definition accepted by the live fetch surface. */
export type InsightFetchDefinition = Pick<
  Insight,
  "baseTableId" | "selectedFields" | "metrics" | "filters" | "sorts" | "joins"
>;

/**
 * Values which may vary when running a saved Insight. Filter keys are stable
 * external control keys mapped to saved filter ids; the saved filter remains
 * the authority for field, operator, default, and type.
 */
export interface InsightRuntimeDeclaration {
  filters?: Array<{
    key: string;
    filterId: string;
    label: string;
    required?: boolean;
    allowClear?: boolean;
  }>;
  sort?: { allowedFieldIds: UUID[]; maxKeys: number };
  limit?: { min: number; max: number };
}

/** Values that an invocation may supply for a saved runtime declaration. */
export interface InsightRuntimeInput {
  /** A null value requests an explicit clear when the saved declaration allows it. */
  filters?: Record<string, unknown>;
  sort?: Array<{ fieldId: UUID; direction: "asc" | "desc" }>;
  limit?: number;
}

/** Server-minted, row-free metadata for a successfully materialized fetch. */
export interface InsightFetchReady {
  status: "ready";
  dataFrameId: UUID;
  schema: readonly { id: UUID; name: string; type: string }[];
  rowCount: number;
  definitionFingerprint: string;
  provenance: { connectorKind: string; bindingVersion: string };
  fetchedAt: number;
  /** Exact server-published source pointers for suppressing only this operation's invalidation. */
  sourceGenerations?: readonly { tableId: UUID; dataFrameId: UUID }[];
}

/** Metadata for a previously successful frame retained after a failed refresh. */
export type InsightFetchStale = Omit<InsightFetchReady, "status"> & {
  stale: true;
};

/** Safe, localizable fetch failure. Diagnostics never contain connector data. */
export interface InsightFetchFailed {
  status: "failed";
  code: string;
  message: string;
  retryable: boolean;
  diagnosticId: string;
  lastSuccessful?: InsightFetchStale;
  /** Exact source pointers published before a later stage failed. */
  sourceGenerations?: readonly { tableId: UUID; dataFrameId: UUID }[];
}

export type InsightFetchResult = InsightFetchReady | InsightFetchFailed;

/**
 * The configuration fields that distinguish a user-modified insight from an
 * unmodified auto-draft. Structural subset satisfied by both {@link Insight}
 * (renderer) and the server-side insight definition.
 */
export interface InsightDraftShape {
  selectedFields?: readonly unknown[];
  metrics?: readonly unknown[];
  filters?: readonly unknown[];
  sorts?: readonly unknown[];
  joins?: readonly unknown[];
}

/**
 * Returns true when an insight has no user modifications: no selected fields,
 * no metrics, no filters, no sorts, and no joins. These are auto-drafts that
 * are safe to reuse rather than accumulate as duplicates.
 *
 * Single source of truth for the unmodified-draft definition, imported by both
 * the renderer dedup hook and the server-side dedup gate so the predicate can
 * never drift between them.
 */
export function isUnmodifiedDraft(insight: InsightDraftShape): boolean {
  return (
    (insight.selectedFields?.length ?? 0) === 0 &&
    (insight.metrics?.length ?? 0) === 0 &&
    (insight.filters?.length ?? 0) === 0 &&
    (insight.sorts?.length ?? 0) === 0 &&
    (insight.joins?.length ?? 0) === 0
  );
}

/**
 * CompiledInsight - An Insight with all IDs resolved to actual entities.
 *
 * This is a "denormalized" view of an Insight where:
 * - selectedFields (UUIDs) → dimensions (resolved Field objects)
 * - metrics remain as InsightMetric (already self-contained with name)
 *
 * Use this when you need the actual field data without additional lookups.
 */
export interface CompiledInsight {
  id: UUID;
  name: string;
  /** Resolved dimension fields (from selectedFields) */
  dimensions: Field[];
  /** Metrics to compute (already contains name for display) */
  metrics: InsightMetric[];
  /** Optional filters */
  filters?: InsightFilter[];
  /** Optional sorts */
  sorts?: InsightSort[];
}
