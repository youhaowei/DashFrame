import type { UUID, InsightMetric } from "../types";
import type { UseQueryResult } from "./types";

// ============================================================================
// Insight Types
// ============================================================================

/**
 * Insight status - tracks computation state.
 */
export type InsightStatus = "pending" | "computing" | "ready" | "error";

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
  /** Computation status */
  status: InsightStatus;
  /** Error message if status is 'error' */
  error?: string;
  /** Associated DataFrame ID (when computed) */
  dataFrameId?: UUID;
  createdAt: number;
  updatedAt?: number;
}

// ============================================================================
// Repository Hook Types
// ============================================================================

/**
 * Result type for useInsights hook.
 */
export type UseInsightsResult = UseQueryResult<Insight[]>;

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

  /** Set insight status */
  setStatus: (id: UUID, status: InsightStatus, error?: string) => Promise<void>;

  /** Link computed DataFrame to insight */
  setDataFrame: (id: UUID, dataFrameId: UUID) => Promise<void>;

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
  withComputedDataOnly?: boolean;
}) => UseInsightsResult;

/**
 * Hook type for insight mutations.
 */
export type UseInsightMutations = () => InsightMutations;
