import type {
  DataFrame,
  UUID,
  Field,
  TableColumn,
  SourceSchema,
} from "@dashframe/dataframe";
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
  fields: Field[],
): Promise<DataFrame> {
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
        !field.columnName || // System fields (_rowIndex, _notionId)
        selectedNames.includes(field.columnName),
    );
  }

  // Query database for all data
  const response = await queryDatabase(apiKey, databaseId);

  // Convert to DataFrame
  return convertNotionToDataFrame(response, activeFields);
}

/**
 * Generate fields from Notion schema (for discovery phase)
 */
export function generateFieldsFromNotionSchema(
  schema: NotionProperty[],
  dataTableId: UUID
): { fields: Field[]; sourceSchema: SourceSchema } {
  // System fields (computed)
  const systemFields: Field[] = [
    {
      id: crypto.randomUUID(),
      name: "_rowIndex",
      tableId: dataTableId,
      columnName: undefined,  // Computed from array index
      type: "number",
    },
    {
      id: crypto.randomUUID(),
      name: "_notionId",
      tableId: dataTableId,
      columnName: undefined,  // Computed from page.id
      type: "string",
    },
  ];

  // User fields from schema
  const userFields: Field[] = schema.map((prop) => ({
    id: crypto.randomUUID(),
    name: prop.name,
    tableId: dataTableId,
    columnName: prop.name,
    type: mapNotionTypeToColumnType(prop.type),
  }));

  // Source schema with native Notion types
  const columns: TableColumn[] = schema.map((prop) => ({
    name: prop.name,
    type: prop.type,  // Native: "status", "relation", etc.
    // TODO: Detect foreign keys from relation properties
  }));

  const sourceSchema: SourceSchema = {
    columns,
    version: 1,
    lastSyncedAt: Date.now(),
  };

  return {
    fields: [...systemFields, ...userFields],
    sourceSchema,
  };
}

/**
 * Fetch sample data (limited rows) from Notion database
 */
export async function notionToDataFrameSample(
  config: NotionConfig,
  fields: Field[],
  pageSize: number = 100
): Promise<DataFrame> {
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
        !field.columnName || // System fields (_rowIndex, _notionId)
        selectedNames.includes(field.columnName),
    );
  }

  // Query database for sample data
  const response = await queryDatabase(apiKey, databaseId, { pageSize });

  // Convert to DataFrame
  return convertNotionToDataFrame(response, activeFields);
}
