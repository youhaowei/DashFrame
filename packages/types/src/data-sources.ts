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
  /** Connector-specific, non-credential settings accepted by the server. */
  config?: CreateDataSourceConfig;
}

/** Allowlisted public configuration accepted when creating a data source. */
export interface CreateDataSourceConfig {
  defaultSchema?: string;
}
