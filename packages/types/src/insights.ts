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
 * Results are computed on-demand via DuckDB, not cached.
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
  createdAt: number;
  updatedAt?: number;
}

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
