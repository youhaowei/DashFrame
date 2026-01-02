/**
 * Shared test fixtures and helpers for QueryBuilder tests
 *
 * Provides:
 * - createMockDataFrame() - Factory for mock DataFrame objects
 * - createMockConnection() - Factory for mock DuckDB connections
 * - createMockConnectionWithResults() - Connection with configurable query results
 * - createMockConnectionForRun() - Connection for Arrow buffer tests
 * - createMockConnectionWithError() - Connection that throws errors
 * - createTestQueryBuilder() - QueryBuilder with pre-set table name
 *
 * Note: The vi.mock() for BrowserDataFrame must be in the test file that needs it,
 * not in this fixtures file, because Vitest hoists mocks to the top of each file.
 */
import { vi } from "vitest";
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { DataFrame } from "@dashframe/engine";
import { QueryBuilder } from "../query-builder";

/**
 * Creates a mock DataFrame object with configurable ID
 */
export const createMockDataFrame = (id: string = "test-df-id"): DataFrame => ({
  id: id as `${string}-${string}-${string}-${string}-${string}`,
  storage: { type: "indexeddb", key: `arrow-${id}` },
  fieldIds: [],
  createdAt: Date.now(),
  toJSON: () => ({
    id: id as `${string}-${string}-${string}-${string}-${string}`,
    storage: { type: "indexeddb", key: `arrow-${id}` },
    fieldIds: [],
    createdAt: Date.now(),
  }),
  getStorageType: () => "indexeddb",
});

/**
 * Creates a basic mock DuckDB connection with empty results
 */
export const createMockConnection = (): AsyncDuckDBConnection => {
  const mockQuery = vi.fn().mockResolvedValue({
    toArray: () => [],
  });

  return {
    query: mockQuery,
    insertArrowFromIPCStream: vi.fn().mockResolvedValue(undefined),
  } as unknown as AsyncDuckDBConnection;
};

/**
 * Creates a mock connection with configurable query results
 */
export const createMockConnectionWithResults = <T = Record<string, unknown>>(
  queryResults: T[],
): AsyncDuckDBConnection => {
  const mockQuery = vi.fn().mockResolvedValue({
    toArray: () => queryResults,
  });

  return {
    query: mockQuery,
    insertArrowFromIPCStream: vi.fn().mockResolvedValue(undefined),
  } as unknown as AsyncDuckDBConnection;
};

/**
 * Creates a mock connection for run() tests that returns Uint8Array
 */
export const createMockConnectionForRun = (
  arrowBuffer: Uint8Array,
): AsyncDuckDBConnection => {
  return createMockConnectionWithResults([arrowBuffer]);
};

/**
 * Creates a mock connection that returns array results (for batchQuery tests)
 */
export const createMockConnectionWithArrayResults = (
  results: Record<string, unknown>[],
): AsyncDuckDBConnection => {
  return {
    query: vi.fn().mockResolvedValue({
      toArray: () => results,
    }),
  } as unknown as AsyncDuckDBConnection;
};

/**
 * Creates a mock connection that throws an error
 */
export const createMockConnectionWithError = (
  error: Error,
): AsyncDuckDBConnection => {
  return {
    query: vi.fn().mockRejectedValue(error),
  } as unknown as AsyncDuckDBConnection;
};

/**
 * Creates a QueryBuilder with a pre-set table name (avoids async table loading)
 */
export const createTestQueryBuilder = (
  df: DataFrame,
  conn: AsyncDuckDBConnection,
  tableName: string = "df_test_df_id",
): QueryBuilder => {
  return new QueryBuilder(df, conn, [], tableName);
};

/**
 * Creates mock user results array for preview tests
 */
export const createMockUserResults = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
  }));
