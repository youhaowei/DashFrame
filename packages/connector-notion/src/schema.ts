/**
 * Notion schema utilities — generates DashFrame Field/SourceSchema from
 * Notion database property definitions. Extracted to break the circular
 * dependency between connector.ts and index.ts.
 */

import type {
  Field,
  SourceSchema,
  TableColumn,
  UUID,
} from "@dashframe/engine-browser";
import {
  createFieldsFromColumns,
  createSourceSchema,
} from "@dashframe/engine-browser";
import type { NotionProperty } from "./client";
import { mapNotionTypeToColumnType } from "./converter";

/**
 * Generate DashFrame fields from a Notion database schema (for discovery phase).
 */
export function generateFieldsFromNotionSchema(
  schema: NotionProperty[],
  dataTableId: UUID,
): { fields: Field[]; sourceSchema: SourceSchema } {
  // Source schema with native Notion types
  const columns: TableColumn[] = schema.map((prop) => ({
    name: prop.name,
    type: prop.type, // Native: "status", "relation", etc.
    // Note: Foreign key detection from relation properties not yet implemented
  }));

  const fields: Field[] = createFieldsFromColumns(
    schema.map((prop) => ({
      name: prop.name,
      type: mapNotionTypeToColumnType(prop.type),
    })),
    dataTableId,
    [
      {
        name: "_notionId",
        type: "string",
        columnName: undefined,
        isIdentifier: true,
      },
    ],
  );

  const sourceSchema: SourceSchema = createSourceSchema(columns);

  return {
    fields,
    sourceSchema,
  };
}
