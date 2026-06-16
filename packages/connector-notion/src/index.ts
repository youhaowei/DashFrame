import type {
  Field,
  SecretResolver,
  SourceSchema,
  UUID,
} from "@dashframe/engine-browser";
import {
  getDatabaseSchema,
  listDatabases,
  queryDatabase,
  type NotionDatabase,
  type NotionProperty,
} from "./client";
import {
  convertNotionToDataFrame,
  mapNotionTypeToColumnType,
  type NotionConversionResult,
} from "./converter";
import { generateFieldsFromNotionSchema } from "./schema";

// Re-export types
export type { NotionConversionResult, NotionDatabase, NotionProperty };

// Re-export utilities
export { mapNotionTypeToColumnType };

// Re-export schema utility (canonical location is schema.ts)
export { generateFieldsFromNotionSchema };

/**
 * Configuration for connecting to a Notion database
 */
export type NotionConfig = {
  apiKey: string;
  databaseId: string;
  selectedPropertyIds?: string[];
};

/**
 * List all databases accessible with the given API key
 */
export async function fetchNotionDatabases(
  apiKey: string,
): Promise<NotionDatabase[]> {
  return listDatabases(apiKey);
}

/**
 * Get the schema (properties/columns) of a specific database
 */
export async function fetchNotionDatabaseSchema(
  apiKey: string,
  databaseId: string,
): Promise<NotionProperty[]> {
  return getDatabaseSchema(apiKey, databaseId);
}

/**
 * Main converter: Fetch data from Notion database and convert to plain data format.
 * Returns NotionConversionResult with rows, columns, Arrow buffer, and metadata.
 * Note: DataFrame instance creation should happen on the client (requires IndexedDB).
 */
export async function notionToDataFrame(
  config: NotionConfig,
  fields: Field[],
): Promise<NotionConversionResult> {
  const { apiKey, databaseId, selectedPropertyIds } = config;

  // Filter fields based on selectedPropertyIds if provided
  let activeFields = fields;
  if (selectedPropertyIds && selectedPropertyIds.length > 0) {
    // Fetch schema to map property IDs to names
    const schema = await getDatabaseSchema(apiKey, databaseId);
    const selectedNames = schema
      .filter((prop) => selectedPropertyIds.includes(prop.id))
      .map((prop) => prop.name);

    // Keep system fields and selected user fields
    activeFields = fields.filter(
      (field) =>
        !field.columnName || // System fields (_notionId)
        selectedNames.includes(field.columnName),
    );
  }

  // Query database for all data
  const response = await queryDatabase(apiKey, databaseId);

  // Convert to DataFrame
  return convertNotionToDataFrame(response, activeFields);
}

/**
 * Fetch sample data (limited rows) from Notion database.
 * Returns NotionConversionResult with rows, columns, Arrow buffer, and metadata.
 * Note: DataFrame instance creation should happen on the client (requires IndexedDB).
 */
export async function notionToDataFrameSample(
  config: NotionConfig,
  fields: Field[],
  pageSize: number = 100,
): Promise<NotionConversionResult> {
  const { apiKey, databaseId, selectedPropertyIds } = config;

  // Filter fields based on selectedPropertyIds if provided
  let activeFields = fields;
  if (selectedPropertyIds && selectedPropertyIds.length > 0) {
    // Fetch schema to map property IDs to names
    const schema = await getDatabaseSchema(apiKey, databaseId);
    const selectedNames = schema
      .filter((prop) => selectedPropertyIds.includes(prop.id))
      .map((prop) => prop.name);

    // Keep system fields and selected user fields
    activeFields = fields.filter(
      (field) =>
        !field.columnName || // System fields (_notionId)
        selectedNames.includes(field.columnName),
    );
  }

  // Query database for sample data
  const response = await queryDatabase(apiKey, databaseId, { pageSize });

  // Convert to DataFrame
  return convertNotionToDataFrame(response, activeFields);
}

// ============================================================================
// Connector Pattern
// ============================================================================

import { NotionConnector } from "./connector";

export {
  NotionConnector,
  NotionConnectorKind,
  notionConnectorKind,
} from "./connector";

// Re-export SecretResolver for consumers that need to mint one
export type { SecretResolver };

// Unused but kept to prevent breaking imports that destructure SourceSchema/UUID
export type { SourceSchema, UUID };

/**
 * Factory: construct an auth-bound {@link NotionConnector} from a resolver.
 *
 * The `auth` resolver is minted at the construction seam (where the vault and
 * ref are in scope) and pre-bound to exactly ONE ref. The connector never sees
 * the vault or the ref — only the resolved plaintext inside its `this.auth`
 * callback (capability attenuation by construction).
 *
 * @param auth - A SecretResolver: `(use) => vault.withSecret(ref, use)`
 *
 * @example
 * ```ts
 * import { SecretVault } from '@wystack/secret-vault';
 * import { createNotionConnector } from '@dashframe/connector-notion';
 *
 * // Factory seam — vault and ref in scope here, not in the pipeline
 * const auth: SecretResolver = (use) => vault.withSecret(ref, use);
 * const connector = createNotionConnector(auth);
 *
 * // Pipeline is auth-blind: no vault, ref, or plaintext in scope
 * const databases = await connector.connect();
 * const result = await connector.query(databaseId, tableId);
 * ```
 */
export function createNotionConnector(auth: SecretResolver): NotionConnector {
  return new NotionConnector(auth);
}
