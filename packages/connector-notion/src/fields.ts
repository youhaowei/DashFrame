import type { Field, SourceSchema, TableColumn, UUID } from "@dashframe/engine";
import { createFieldsFromColumns, createSourceSchema } from "@dashframe/engine";
import type { NotionProperty } from "./client";
import { mapNotionTypeToColumnType } from "./converter";

/**
 * Generate fields from Notion schema (for discovery phase)
 */
export function generateFieldsFromNotionSchema(
  schema: NotionProperty[],
  dataTableId: UUID,
): { fields: Field[]; sourceSchema: SourceSchema } {
  // System field names reserved by the connector — filter any Notion properties
  // whose name collides so the duplicate-field guard in convertNotionToDataFrame
  // never fires on an otherwise valid Notion database.
  const RESERVED_FIELD_NAMES = new Set(["_notionId"]);
  const userSchema = schema.filter((p) => !RESERVED_FIELD_NAMES.has(p.name));

  // Source schema with native Notion types
  const columns: TableColumn[] = userSchema.map((prop) => ({
    name: prop.name,
    type: prop.type, // Native: "status", "relation", etc.
    // Note: Foreign key detection from relation properties not yet implemented
  }));

  const fields: Field[] = createFieldsFromColumns(
    userSchema.map((prop) => ({
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
