import type { UseQueryResult } from "./repository-base";
import type { UUID } from "./uuid";

// ============================================================================
// Data Source Types
// ============================================================================

/**
 * Public-safe connector config blob on the DataSource read DTO.
 *
 * Credential fields (apiKey, connectionString) are represented as boolean
 * presence flags — never as the raw SecretRef or plaintext. The connector
 * KIND (DataSource.type) interprets any additional keys.
 *
 * This is the structured, safe-to-diff config; the server strips secret refs
 * before populating it. Non-credential keys are passed through as-is.
 */
export type ConnectorConfig = {
  /** True when an API key is stored in the vault. Never the raw value. */
  hasApiKey: boolean;
  /** True when a connection string is stored in the vault. Never the raw value. */
  hasConnectionString: boolean;
  /** Any additional non-credential connector settings, kind-interpreted. */
  [key: string]: unknown;
};

/**
 * DataSource interface - generic for any connector type.
 * Type is the connector ID from the registry (e.g., "csv", "notion").
 *
 * SECURITY: this is a read DTO. Raw credential values are NEVER returned
 * by the read path. Presence is indicated by boolean flags inside `config`
 * so the UI can show "key is set" without receiving the secret itself.
 */
export interface DataSource {
  id: UUID;
  type: string; // Connector ID from registry
  name: string;
  /**
   * Public-safe connector config. Credential slots are boolean presence
   * flags; non-credential keys are passed through as-is.
   * Always set by the read path (rowToDataSource), so non-optional.
   */
  config: ConnectorConfig;
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
  /** Update a data source by ID.
   * `apiKey` and `connectionString` are write-only fields accepted here
   * but never returned by the read path.
   */
  update: (
    id: UUID,
    updates: Partial<Pick<DataSource, "name">> &
      Pick<CreateDataSourceInput, "apiKey" | "connectionString">,
  ) => Promise<void>;
  /** Remove a data source by ID */
  remove: (id: UUID) => Promise<void>;
}

/**
 * Hook type for reading data sources.
 * Implemented by @dashframe/app-data (WyStack server path).
 */
export type UseDataSources = () => UseDataSourcesResult;

/**
 * Hook type for data source mutations.
 * Implemented by @dashframe/app-data (WyStack server path).
 */
export type UseDataSourceMutations = () => DataSourceMutations;
