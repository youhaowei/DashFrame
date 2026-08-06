import type { TableColumn } from "@dashframe/types";
import type { DataFrame } from "./dataframe";

/**
 * Query result from engine execution.
 */
export interface QueryResult {
  /** Column definitions */
  columns: TableColumn[];
  /** Result rows as records */
  rows: Record<string, unknown>[];
  /** Number of rows returned */
  rowCount: number;
}

/**
 * QueryEngine interface — execute SQL against registered tables.
 *
 * Real implementers today:
 * - `NativeDuckDBEngine` (`@dashframe/engine-server`) — native DuckDB
 *
 * Browser query paths use DuckDB-WASM helpers in `@dashframe/engine-browser`
 * but do not implement this interface. There is no Postgres `QueryEngine` and no
 * shared `QueryPlanner` / `QueryPushDownCapable` API in this package.
 * Individual connectors may still run remote queries themselves (e.g. the
 * Postgres connector pushes LIMIT/OFFSET on table-reference fetches); that is
 * connector-local, not a cross-engine planner.
 */
export interface QueryEngine {
  /**
   * Execute a SQL query and return results.
   * @param sql - SQL query string
   */
  query(sql: string): Promise<QueryResult>;

  /**
   * Register a DataFrame as a named table for queries.
   * @param name - Table name to use in queries
   * @param dataFrame - DataFrame to register
   */
  registerTable(name: string, dataFrame: DataFrame): Promise<void>;

  /**
   * Register Arrow IPC data directly as a table.
   * @param name - Table name to use in queries
   * @param arrowBuffer - Arrow IPC buffer
   */
  registerArrowTable(name: string, arrowBuffer: Uint8Array): Promise<void>;

  /**
   * Unregister a table.
   * @param name - Table name to remove
   */
  unregisterTable(name: string): Promise<void>;

  /**
   * Check if a table is registered.
   * @param name - Table name to check
   */
  hasTable(name: string): boolean;

  /**
   * Get list of registered table names.
   */
  getTableNames(): string[];

  /**
   * Check if engine is initialized and ready.
   */
  isReady(): boolean;

  /**
   * Initialize the engine (load WASM, connect to DB, etc.).
   */
  initialize(): Promise<void>;

  /**
   * Cleanup resources.
   */
  dispose(): Promise<void>;
}
