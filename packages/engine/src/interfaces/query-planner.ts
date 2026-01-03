import type { UUID } from "@dashframe/types";
import type { RemoteApiConnector } from "../connector/base";
import type { DataFrame } from "./dataframe";

// ============================================================================
// Query Representation
// ============================================================================

/**
 * Abstract query representation for planning purposes.
 * Not tied to SQL - represents the logical operation.
 */
export interface Query {
  /** Target DataFrame or table */
  dataFrameId: UUID;

  /** Columns to select (undefined = all) */
  select?: string[];

  /** Filter predicates */
  filters?: QueryFilter[];

  /** Aggregations to compute */
  aggregations?: QueryAggregation[];

  /** Group by columns */
  groupBy?: string[];

  /** Sort order */
  orderBy?: QuerySort[];

  /** Row limit */
  limit?: number;

  /** Row offset for pagination */
  offset?: number;
}

export interface QueryFilter {
  column: string;
  operator: "=" | "!=" | ">" | "<" | ">=" | "<=" | "IN" | "NOT IN" | "LIKE";
  value: unknown;
}

export interface QueryAggregation {
  column?: string;
  function: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
  alias: string;
}

export interface QuerySort {
  column: string;
  direction: "asc" | "desc";
}

// ============================================================================
// Execution Strategy
// ============================================================================

/**
 * Where and how a query should be executed.
 */
export type ExecutionStrategy = "local" | "remote" | "hybrid";

/**
 * Reason for choosing an execution strategy.
 */
export type ExecutionReason =
  | "data-cached" // Data exists in local storage
  | "no-cache" // Data not cached, must fetch
  | "push-down" // Query can be executed remotely (e.g., PostgreSQL)
  | "partial-push-down" // Some operations remote, some local
  | "connector-limitation"; // Connector doesn't support remote queries

/**
 * Execution plan returned by the QueryPlanner.
 */
export type ExecutionPlan =
  | {
      /** Execute entirely on local cached data */
      strategy: "local";
      reason: "data-cached";
    }
  | {
      /** Execute entirely on remote source */
      strategy: "remote";
      reason: "push-down";
      /** The connector to use for remote execution */
      connector: RemoteApiConnector;
      /** Query operations to push down (may be subset of original) */
      remoteQuery: Partial<Query>;
    }
  | {
      /** Fetch data first, then execute locally */
      strategy: "hybrid";
      reason: "no-cache" | "connector-limitation" | "partial-push-down";
      /** If true, need to fetch/refresh data before querying */
      fetchFirst: boolean;
      /** The connector to fetch from (if fetchFirst is true) */
      connector?: RemoteApiConnector;
      /** Operations that can be pushed to remote (optimization) */
      remoteOperations?: Array<"filter" | "limit" | "offset">;
    };

// ============================================================================
// QueryPlanner Interface
// ============================================================================

/**
 * QueryPlanner determines the optimal execution strategy for a query.
 *
 * The planner considers:
 * 1. Is the data cached locally? → Execute locally
 * 2. Can the query be pushed to the remote source? → Execute remotely
 * 3. Otherwise → Fetch data first, then execute locally
 *
 * Implementations:
 * - BrowserQueryPlanner (engine-browser) - Uses IndexedDB cache status
 * - ServerQueryPlanner (engine-server) - Uses PostgreSQL/DuckDB directly
 */
export interface QueryPlanner {
  /**
   * Plan the execution strategy for a query.
   *
   * @param query - The query to plan
   * @param dataFrame - The target DataFrame (contains storage info)
   * @param connector - Optional connector for remote sources
   * @returns Execution plan with strategy and metadata
   */
  plan(
    query: Query,
    dataFrame: DataFrame,
    connector?: RemoteApiConnector,
  ): Promise<ExecutionPlan>;

  /**
   * Check if data for a DataFrame is cached locally.
   *
   * @param dataFrameId - The DataFrame to check
   * @returns true if data is available locally
   */
  isCached(dataFrameId: UUID): Promise<boolean>;
}

// ============================================================================
// Connector Capabilities (Optional Extension)
// ============================================================================

/**
 * Operations that can potentially be pushed to a remote source.
 */
export type PushDownOperation =
  | "filter"
  | "sort"
  | "limit"
  | "offset"
  | "aggregation"
  | "group-by";

/**
 * Extended capabilities for remote connectors that support query push-down.
 *
 * Most API connectors (Notion, Airtable) have limited push-down support.
 * Database connectors (PostgreSQL, MySQL) support full push-down.
 *
 * This is an optional mixin - connectors can implement these methods
 * to advertise their capabilities to the QueryPlanner.
 */
export interface QueryPushDownCapable {
  /**
   * Check if this connector supports pushing down queries.
   * @returns true if any query operations can be executed remotely
   */
  supportsQueryPushDown(): boolean;

  /**
   * Get the list of operations this connector can execute remotely.
   * @returns Array of supported push-down operations
   */
  supportedPushDownOperations(): PushDownOperation[];

  /**
   * Check if a specific query can be fully pushed down.
   * @param query - The query to check
   * @returns true if the entire query can be executed remotely
   */
  canFullyPushDown?(query: Query): boolean;
}

/**
 * Type guard to check if a connector supports query push-down.
 */
export function isQueryPushDownCapable(
  connector: unknown,
): connector is QueryPushDownCapable {
  return (
    typeof connector === "object" &&
    connector !== null &&
    "supportsQueryPushDown" in connector &&
    typeof (connector as QueryPushDownCapable).supportsQueryPushDown ===
      "function"
  );
}
