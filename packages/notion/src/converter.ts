import type {
  DataFrame,
  DataFrameRow,
  ColumnType,
  Field,
} from "@dashframe/dataframe";
import type {
  QueryDatabaseResponse,
  PageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
import type { NotionProperty } from "./client";

type PropertyValue = PageObjectResponse["properties"][string];

/**
 * Map Notion property types to DataFrame column types
 */
export function mapNotionTypeToColumnType(notionType: string): ColumnType {
  switch (notionType) {
    case "number":
      return "number";
    case "date":
      return "date";
    case "checkbox":
      return "boolean";
    case "title":
    case "rich_text":
    case "select":
    case "multi_select":
    case "url":
    case "email":
    case "phone_number":
    case "status":
    case "created_time":
    case "last_edited_time":
    default:
      return "string";
  }
}

/**
 * Extract text from rich text array
 */
function extractRichText(
  richTextArray: Array<{ type: string; text?: { content: string } }>,
): string {
  return richTextArray
    .map((t) => (t.type === "text" && t.text ? t.text.content : ""))
    .join("");
}

/**
 * Extract value from a formula property
 */
function extractFormulaValue(
  formula: Extract<PropertyValue, { type: "formula" }>["formula"],
): unknown {
  switch (formula.type) {
    case "string":
      return formula.string;
    case "number":
      return formula.number;
    case "boolean":
      return formula.boolean;
    case "date":
      return formula.date?.start || null;
    default:
      return null;
  }
}

/**
 * Extract value from a rollup property
 */
function extractRollupValue(
  rollup: Extract<PropertyValue, { type: "rollup" }>["rollup"],
): unknown {
  switch (rollup.type) {
    case "number":
      return rollup.number;
    case "date":
      return rollup.date?.start || null;
    case "array":
      return rollup.array?.length || 0;
    default:
      return null;
  }
}

/**
 * Extract array of names from people property
 */
function extractPeopleValue(
  people: Extract<PropertyValue, { type: "people" }>["people"],
): string | null {
  if (people.length === 0) return null;
  return people.map((p) => ("name" in p ? p.name : p.id)).join(", ");
}

/**
 * Extract array of file names
 */
function extractFilesValue(
  files: Extract<PropertyValue, { type: "files" }>["files"],
): string | null {
  if (files.length === 0) return null;
  return files.map((f) => f.name).join(", ");
}

/**
 * Extract array of relation IDs
 */
function extractRelationValue(
  relation: Extract<PropertyValue, { type: "relation" }>["relation"],
): string | null {
  if (relation.length === 0) return null;
  return relation.map((r) => r.id).join(", ");
}

/**
 * Extract value from a Notion property based on its type
 */
export function extractPropertyValue(property: PropertyValue): unknown {
  if (!property) return null;

  switch (property.type) {
    case "title":
      if (property.title.length === 0) return null;
      return extractRichText(property.title);

    case "rich_text":
      if (property.rich_text.length === 0) return null;
      return extractRichText(property.rich_text);

    case "number":
      return property.number;

    case "select":
      return property.select?.name || null;

    case "multi_select":
      if (property.multi_select.length === 0) return null;
      return property.multi_select.map((s) => s.name).join(", ");

    case "date":
      if (!property.date) return null;
      return property.date.start;

    case "checkbox":
      return property.checkbox;

    case "url":
      return property.url;

    case "email":
      return property.email;

    case "phone_number":
      return property.phone_number;

    case "status":
      return property.status?.name || null;

    case "created_time":
      return property.created_time;

    case "last_edited_time":
      return property.last_edited_time;

    case "people":
      return extractPeopleValue(property.people);

    case "files":
      return extractFilesValue(property.files);

    case "relation":
      return extractRelationValue(property.relation);

    case "formula":
      return extractFormulaValue(property.formula);

    case "rollup":
      return extractRollupValue(property.rollup);

    default:
      return null;
  }
}

/**
 * Convert Notion query response to DataFrame using pre-generated fields
 */
export function convertNotionToDataFrame(
  response: QueryDatabaseResponse,
  fields: Field[],
): DataFrame {
  // Convert Notion pages to DataFrame rows
  const rows: DataFrameRow[] = response.results
    .filter((result): result is PageObjectResponse => result.object === "page")
    .map((page, index) => {
      const row: DataFrameRow = {};

      // Extract values for each field
      fields.forEach((field) => {
        if (field.name === "_rowIndex") {
          // Computed field: array index
          row[field.name] = index;
        } else if (field.name === "_notionId") {
          // Computed field: Notion page ID
          row[field.name] = page.id;
        } else if (field.columnName) {
          // User field: extract from Notion property
          const property = page.properties[field.columnName];
          row[field.name] = extractPropertyValue(property);
        }
      });

      return row;
    });

  return {
    fieldIds: fields.map(f => f.id),
    primaryKey: "_notionId",
    rows,
  };
}
