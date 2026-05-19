import type {
  ColumnType,
  DataFrame,
  Field,
  SourceSchema,
  UUID,
} from "@dashframe/engine-browser";
import {
  createArrowIPCBufferFromRows,
  createFieldsFromColumns,
  createSourceSchema,
  DataFrame as DataFrameClass,
  detectPrimaryKeyColumn,
  parsePrimitiveValueByType,
} from "@dashframe/engine-browser";
import {
  extractKeys,
  flattenObjectArray,
  type FlattenOptions,
  type JsonPrimitive,
  type JsonValue,
} from "./flatten";

/**
 * Represents JSON data that can be converted to a DataFrame.
 * Can be an array of objects or a single object (which will be wrapped in an array).
 */
export type JSONData = JsonValue[] | Record<string, JsonValue>;

/**
 * Options for JSON to DataFrame conversion.
 */
export interface JSONConversionOptions extends FlattenOptions {
  /**
   * Whether to wrap a single object in an array.
   * Default: true
   */
  wrapSingleObject?: boolean;
}

/**
 * Infer column type from a JSON primitive value.
 * JSON values are already typed, so this is simpler than CSV type inference.
 */
const inferType = (value: JsonPrimitive): ColumnType => {
  if (value === null) return "unknown";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") {
    // Check if it's a date string
    const date = Date.parse(value);
    if (!Number.isNaN(date)) {
      // Additional check: ensure it looks like a date (has separators like - or /)
      // This avoids matching simple numeric strings
      if (/[-/:]/.test(value) && value.length >= 8) {
        return "date";
      }
    }
    return "string";
  }
  return "unknown";
};

/**
 * Infer the best column type from multiple sample values.
 * Uses the first non-null value for type inference.
 */
const inferColumnType = (values: JsonPrimitive[]): ColumnType => {
  for (const value of values) {
    if (value !== null) {
      return inferType(value);
    }
  }
  return "unknown";
};

/**
 * JSON conversion result.
 * - dataFrame: DataFrame class instance (reference to IndexedDB storage)
 * - fields: Field definitions for the columns
 * - sourceSchema: Source column metadata
 * - rowCount: Number of data rows (for metadata)
 * - columnCount: Number of columns (for metadata)
 */
export interface JSONConversionResult {
  /** DataFrame class instance (data stored in IndexedDB) */
  dataFrame: DataFrame;
  /** Field definitions */
  fields: Field[];
  /** Source schema metadata */
  sourceSchema: SourceSchema;
  /** Row count for metadata */
  rowCount: number;
  /** Column count for metadata */
  columnCount: number;
}

/**
 * Converts JSON data into a DataFrame with IndexedDB storage.
 * Supports both array-of-objects and nested JSON structures.
 * Nested objects are flattened using dot-notation (e.g., 'user.address.city').
 *
 * @param jsonData - Array of objects or a single object
 * @param dataTableId - The UUID for the data table
 * @param options - Conversion options (including flattening options)
 * @returns Promise containing the DataFrame and metadata
 *
 * @example
 * ```typescript
 * // Array of objects
 * const result = await jsonToDataFrame([
 *   { name: 'Alice', age: 30 },
 *   { name: 'Bob', age: 25 }
 * ], tableId);
 *
 * // Nested objects (will be flattened)
 * const result = await jsonToDataFrame([
 *   { user: { name: 'Alice', address: { city: 'NYC' } } }
 * ], tableId);
 * // Columns: user.name, user.address.city
 * ```
 */
export async function jsonToDataFrame(
  jsonData: JSONData,
  dataTableId: UUID,
  options: JSONConversionOptions = {},
): Promise<JSONConversionResult> {
  const { wrapSingleObject = true, ...flattenOptions } = options;

  // Guard against null input (typeof null === "object")
  if (jsonData === null) {
    throw new Error("JSON data cannot be null");
  }

  // Normalize input to array of objects
  let dataArray: JsonValue[];

  if (Array.isArray(jsonData)) {
    dataArray = jsonData;
  } else if (wrapSingleObject && typeof jsonData === "object") {
    dataArray = [jsonData as JsonValue];
  } else {
    throw new Error("JSON data must be an array of objects or a single object");
  }

  if (dataArray.length === 0) {
    throw new Error("JSON data is empty");
  }

  // Step 2: Flatten nested objects
  const flattenedRows = flattenObjectArray(dataArray, flattenOptions);
  const columnNames = extractKeys(flattenedRows);

  if (columnNames.length === 0) {
    throw new Error("JSON data has no extractable columns");
  }

  // Infer column types from flattened data
  const userColumns = columnNames.map((name) => {
    const values = flattenedRows.map((row) => row[name] ?? null);
    return {
      name,
      type: inferColumnType(values),
    };
  });

  const primaryKey = detectPrimaryKeyColumn(userColumns);

  // Create rows with parsed values
  const rows = flattenedRows.map((flatRow) => {
    const row: Record<string, unknown> = {};
    for (const col of userColumns) {
      row[col.name] = parsePrimitiveValueByType(
        flatRow[col.name] ?? null,
        col.type,
      );
    }
    return row;
  });

  const sourceSchema: SourceSchema = createSourceSchema(userColumns);
  const fields: Field[] = createFieldsFromColumns(userColumns, dataTableId);
  const ipcBuffer = createArrowIPCBufferFromRows(rows, userColumns);

  // Step 8: Create DataFrame with IndexedDB storage
  const dataFrame = await DataFrameClass.create(
    ipcBuffer,
    fields.map((f) => f.id),
    {
      storageType: "indexeddb",
      primaryKey,
    },
  );

  return {
    dataFrame,
    fields,
    sourceSchema,
    rowCount: rows.length,
    columnCount: userColumns.length,
  };
}

// ============================================================================
// Flatten Utilities
// ============================================================================

export {
  extractKeys,
  flattenObject,
  flattenObjectArray,
  unflattenObject,
  type FlattenedObject,
  type FlattenOptions,
  type JsonPrimitive,
  type JsonValue,
} from "./flatten";
