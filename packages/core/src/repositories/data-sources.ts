import type { UUID } from "../types";
import type { UseQueryResult } from "./types";

// ============================================================================
// Data Source Types
// ============================================================================

/**
 * Base DataSource interface.
 * Extended by LocalDataSource and NotionDataSource.
 */
export interface DataSource {
  id: UUID;
  type: "local" | "notion";
  name: string;
  createdAt: number;
}

/**
 * Local data source for CSV uploads and local files.
 */
export interface LocalDataSource extends DataSource {
  type: "local";
}

/**
 * Notion data source with API key.
 */
export interface NotionDataSource extends DataSource {
  type: "notion";
  apiKey: string;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isLocalDataSource(
  source: DataSource,
): source is LocalDataSource {
  return source.type === "local";
}

export function isNotionDataSource(
  source: DataSource,
): source is NotionDataSource {
  return source.type === "notion";
}

// ============================================================================
// Repository Hook Types
// ============================================================================

/**
 * Result type for useDataSources hook.
 */
export type UseDataSourcesResult = UseQueryResult<DataSource[]>;

/**
 * Mutation methods for data sources.
 */
export interface DataSourceMutations {
  /** Add a new local data source */
  addLocal: (name: string) => Promise<UUID>;
  /** Set (create or update) the Notion connection */
  setNotion: (name: string, apiKey: string) => Promise<UUID>;
  /** Remove a data source by ID */
  remove: (id: UUID) => Promise<void>;
  /** Clear the Notion connection */
  clearNotion: () => Promise<void>;
}

/**
 * Hook type for reading data sources.
 * Implementations provided by core-dexie or core-convex.
 */
export type UseDataSources = () => UseDataSourcesResult;

/**
 * Hook type for data source mutations.
 * Implementations provided by core-dexie or core-convex.
 */
export type UseDataSourceMutations = () => DataSourceMutations;
