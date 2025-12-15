import type { UUID } from "./uuid";
import type { InsightMetric } from "./metric";
import type { UseQueryResult } from "./repository-base";

// ============================================================================
// Insight Types
// ============================================================================

/**
 * Filter predicate for insights.
 */
export interface InsightFilter {
  field: string;
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
  value: unknown;
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

// ============================================================================
// Repository Hook Types
// ============================================================================

/**
 * Mutation methods for insights.
 */
export interface InsightMutations {
  /** Create a new insight */
  create: (
    name: string,
    baseTableId: UUID,
    options?: {
      selectedFields?: UUID[];
      metrics?: InsightMetric[];
    },
  ) => Promise<UUID>;

  /** Update an insight */
  update: (
    id: UUID,
    updates: Partial<Omit<Insight, "id" | "createdAt">>,
  ) => Promise<void>;

  /** Remove an insight */
  remove: (id: UUID) => Promise<void>;

  /** Add a field to insight */
  addField: (insightId: UUID, fieldId: UUID) => Promise<void>;

  /** Remove a field from insight */
  removeField: (insightId: UUID, fieldId: UUID) => Promise<void>;

  /** Add a metric to insight */
  addMetric: (insightId: UUID, metric: InsightMetric) => Promise<void>;

  /** Update a metric */
  updateMetric: (
    insightId: UUID,
    metricId: UUID,
    updates: Partial<InsightMetric>,
  ) => Promise<void>;

  /** Remove a metric */
  removeMetric: (insightId: UUID, metricId: UUID) => Promise<void>;
}

/**
 * Hook type for reading insights.
 */
export type UseInsights = (options?: {
  excludeIds?: UUID[];
}) => UseQueryResult<Insight[]>;

/**
 * Hook type for insight mutations.
 */
export type UseInsightMutations = () => InsightMutations;
