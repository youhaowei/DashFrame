import type { UUID } from "./uuid";
import type { UseQueryResult } from "./repository-base";

// ============================================================================
// Data Source Types
// ============================================================================

/**
 * DataSource interface - generic for any connector type.
 * Type is the connector ID from the registry (e.g., "csv", "notion").
 */
export interface DataSource {
  id: UUID;
  type: string; // Connector ID from registry
  name: string;
  // Connector-specific fields (optional based on connector type)
  apiKey?: string; // For remote API connectors (e.g., Notion)
  connectionString?: string; // For database connectors (future)
  createdAt: number;
}

/**
 * Input for creating a new data source.
 */
export interface CreateDataSourceInput {
  type: string;
  name: string;
  apiKey?: string;
  connectionString?: string;
}

// ============================================================================
// Repository Hook Types
// ============================================================================

/**
 * Result type for useDataSources hook.
 */
export type UseDataSourcesResult = UseQueryResult<DataSource[]>;

/**
 * Mutation methods for data sources - pure CRUD operations.
 * Connector-specific validation should happen at the UI/hook layer.
 */
export interface DataSourceMutations {
  /** Add a new data source */
  add: (input: CreateDataSourceInput) => Promise<UUID>;
  /** Update a data source by ID */
  update: (
    id: UUID,
    updates: Partial<Pick<DataSource, "name" | "apiKey" | "connectionString">>,
  ) => Promise<void>;
  /** Remove a data source by ID */
  remove: (id: UUID) => Promise<void>;
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
