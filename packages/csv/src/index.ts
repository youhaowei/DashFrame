import type {
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
  inferStringColumnType,
  parseStringValueByType,
} from "@dashframe/engine-browser";

/**
 * Represents CSV data as an array of string arrays.
 * First array contains headers, subsequent arrays contain data rows.
 * Can be either a 2D array or a 1D array (for single row data).
 */
export type CSVData = string[][] | string[];

/**
 * CSV conversion result.
 * - dataFrame: DataFrame class instance (reference to IndexedDB storage)
 * - fields: Field definitions for the columns
 * - sourceSchema: Source column metadata
 * - rowCount: Number of data rows (for metadata)
 * - columnCount: Number of columns (for metadata)
 */
export interface CSVConversionResult {
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
 * Converts CSV data into a DataFrame with IndexedDB storage.
 * Data is stored as Arrow IPC format in IndexedDB, not in localStorage.
 */
export async function csvToDataFrame(
  csvData: CSVData,
  dataTableId: UUID,
): Promise<CSVConversionResult> {
  // Step 1: Parse CSV and infer schema
  const data = Array.isArray(csvData[0])
    ? (csvData as string[][])
    : [csvData as string[]];

  const [header, ...rawRows] = data;
  if (!header) {
    throw new Error("CSV data is empty");
  }
  const rowsData = rawRows.filter((row) =>
    row.some((cell) => cell !== undefined && cell !== ""),
  );

  // Create columns from CSV headers and infer types
  const userColumns = header.map((name, index) => {
    const sampleValue =
      rowsData.find((row) => row[index] !== undefined && row[index] !== "")?.[
        index
      ] ?? "";
    return {
      name,
      type: inferStringColumnType(sampleValue),
    };
  });

  const primaryKey = detectPrimaryKeyColumn(userColumns);

  // Create rows with parsed values
  const rows = rowsData.map((row) =>
    header.reduce<Record<string, unknown>>((acc, key, colIndex) => {
      const column = userColumns[colIndex];
      if (column) acc[key] = parseStringValueByType(row[colIndex], column.type);
      return acc;
    }, {}),
  );

  const sourceSchema: SourceSchema = createSourceSchema(userColumns);
  const fields: Field[] = createFieldsFromColumns(userColumns, dataTableId);
  const ipcBuffer = createArrowIPCBufferFromRows(rows, userColumns);

  // Create DataFrame with IndexedDB storage
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
// Parser Utility
// ============================================================================

export { parseCSV } from "./parser";
