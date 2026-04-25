/**
 * Query builder types - Abstract query operations.
 * These types are used by QueryBuilder implementations.
 */

/**
 * Filter operators for WHERE clauses.
 */
export type FilterOperator =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "LIKE"
  | "IN"
  | "IS NULL"
  | "IS NOT NULL";

/**
 * Filter predicate for query building.
 */
export interface FilterPredicate {
  column: string;
  operator: FilterOperator;
  value: unknown;
}

/**
 * Sort direction.
 */
export type SortDirection = "ASC" | "DESC";

/**
 * Sort order specification.
 */
export interface SortOrder {
  column: string;
  direction: SortDirection;
}

/**
 * Aggregation function names.
 */
export type AggregationFunction =
  | "SUM"
  | "AVG"
  | "COUNT"
  | "MIN"
  | "MAX"
  | "COUNT_DISTINCT";

/**
 * Aggregation specification.
 */
export interface Aggregation {
  function: AggregationFunction;
  column?: string; // Optional for COUNT(*)
  alias: string;
}

/**
 * Join types.
 */
export type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL";

/**
 * Join options for query building.
 */
export interface JoinOptions {
  type: JoinType;
  rightTable: string;
  leftKey: string;
  rightKey: string;
}
