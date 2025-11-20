import type { DataFrame } from "@dash-frame/dataframe";
import {
  listDatabases,
  getDatabaseSchema,
  queryDatabase,
  type NotionDatabase,
  type NotionProperty,
} from "./client";
import { convertNotionToDataFrame, mapNotionTypeToColumnType } from "./converter";

// Re-export types
export type { NotionDatabase, NotionProperty };

// Re-export utilities
export { mapNotionTypeToColumnType };

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
 * Main converter: Fetch data from Notion database and convert to DataFrame
 */
export async function notionToDataFrame(
  config: NotionConfig,
): Promise<DataFrame> {
  const { apiKey, databaseId, selectedPropertyIds } = config;

  // Fetch database schema
  const schema = await getDatabaseSchema(apiKey, databaseId);

  // Query database for all data
  const response = await queryDatabase(apiKey, databaseId);

  // Convert to DataFrame
  return convertNotionToDataFrame(response, schema, selectedPropertyIds);
}
