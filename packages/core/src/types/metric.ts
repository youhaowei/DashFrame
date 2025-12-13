import type { UUID } from "./uuid";

/**
 * Supported aggregation functions.
 */
export type AggregationType =
  | "sum"
  | "avg"
  | "count"
  | "min"
  | "max"
  | "count_distinct";

/**
 * Metric - An aggregation definition.
 *
 * Metrics define how to aggregate column values:
 * - SUM of sales
 * - COUNT of rows
 * - AVG of ratings
 */
export type Metric = {
  id: UUID;
  name: string;
  /** Which DataTable owns this metric (lineage) */
  tableId: UUID;
  /** Which TableColumn to aggregate (undefined for count()) */
  columnName?: string;
  aggregation: AggregationType;
};

/**
 * InsightMetric - A computed column in an Insight.
 * Similar to Metric but tracks source table explicitly.
 */
export interface InsightMetric {
  id: UUID;
  name: string;
  /** Which table (base or joined) - for v1, always baseTable.tableId */
  sourceTable: UUID;
  /** Which column to aggregate (undefined for count()) */
  columnName?: string;
  aggregation: AggregationType;
}
