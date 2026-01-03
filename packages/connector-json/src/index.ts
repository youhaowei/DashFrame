import type {
  ColumnType,
  DataFrame,
  Field,
  SourceSchema,
  TableColumn,
  UUID,
} from "@dashframe/engine-browser";
import { DataFrame as DataFrameClass } from "@dashframe/engine-browser";
import {
  Bool,
  Float64,
  Table,
  tableToIPC,
  TimestampMillisecond,
  Utf8,
  vectorFromArray,
  type DataType,
  type Vector,
} from "apache-arrow";
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
 * Parse a raw value into the appropriate typed value for Arrow.
 * For date columns, returns Date objects for proper Arrow serialization.
 */
const parseValue = (raw: JsonPrimitive, type: ColumnType): unknown => {
  if (raw === null) {
    return null;
  }

  switch (type) {
    case "number": {
      if (typeof raw === "number") {
        return raw;
      }
      // Handle stringified numbers
      const numeric = Number(raw);
      return Number.isNaN(numeric) ? null : numeric;
    }
    case "boolean":
      if (typeof raw === "boolean") {
        return raw;
      }
      // For non-boolean types (string/number), check for truthy string value
      return raw === "true";
    case "date": {
      if (typeof raw === "string") {
        const date = new Date(raw);
        return Number.isNaN(date.getTime()) ? null : date;
      }
      return null;
    }
    default:
      // Convert to string for string and unknown types
      return String(raw);
  }
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

  // Step 1: Normalize input to array of objects
  let dataArray: JsonValue[];

  if (Array.isArray(jsonData)) {
    dataArray = jsonData;
  } else if (wrapSingleObject && typeof jsonData === "object") {
    // Single object - wrap in array
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

  // Step 3: Infer column types from flattened data
  const userColumns = columnNames.map((name) => {
    const values = flattenedRows.map((row) => row[name]);
    return {
      name,
      type: inferColumnType(values),
    };
  });

  // Detect ID column by name pattern (matches: id, _id, ID, Id, etc.)
  const detectedIdColumn = userColumns.find((col) => /^_?id$/i.test(col.name));
  const primaryKey = detectedIdColumn ? detectedIdColumn.name : "_rowIndex";

  // Step 4: Create rows with parsed values and _rowIndex
  const rows = flattenedRows.map((flatRow, index) => {
    const row: Record<string, unknown> = { _rowIndex: index };
    for (const col of userColumns) {
      row[col.name] = parseValue(flatRow[col.name], col.type);
    }
    return row;
  });

  // Step 5: Build source schema (no _rowIndex in source - it's computed)
  const columns: TableColumn[] = userColumns.map((col) => ({
    name: col.name,
    type: col.type,
  }));

  const sourceSchema: SourceSchema = {
    columns,
    version: 1,
    lastSyncedAt: Date.now(),
  };

  // Step 6: Auto-generate fields (including _rowIndex computed field)
  const fields: Field[] = [
    // System field - computed from array index
    {
      id: crypto.randomUUID(),
      name: "_rowIndex",
      tableId: dataTableId,
      columnName: undefined, // Computed field
      type: "number",
      isIdentifier: true, // Mark as identifier to exclude from chart suggestions
    },
    // User fields from source
    ...columns.map((col) => ({
      id: crypto.randomUUID(),
      name: col.name,
      tableId: dataTableId,
      columnName: col.name,
      type: col.type as ColumnType,
    })),
  ];

  // Step 7: Convert to Arrow table with explicit types
  const allColumns = [
    { name: "_rowIndex", type: "number" as ColumnType },
    ...userColumns,
  ];

  const arrowColumns: Record<string, Vector<DataType>> = {};
  for (const col of allColumns) {
    const values = rows.map((row) => row[col.name]);

    // Create typed Arrow vectors based on column type
    switch (col.type) {
      case "number":
        arrowColumns[col.name] = vectorFromArray(values, new Float64());
        break;
      case "boolean":
        arrowColumns[col.name] = vectorFromArray(values, new Bool());
        break;
      case "date":
        // TimestampMillisecond ensures DuckDB recognizes this as temporal
        arrowColumns[col.name] = vectorFromArray(
          values,
          new TimestampMillisecond(),
        );
        break;
      default:
        arrowColumns[col.name] = vectorFromArray(values, new Utf8());
    }
  }

  const arrowTable = new Table(arrowColumns);
  const ipcBuffer = tableToIPC(arrowTable);

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
// Exports - Flatten utilities and Connector
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

export { JSONConnector, jsonConnector } from "./connector";
