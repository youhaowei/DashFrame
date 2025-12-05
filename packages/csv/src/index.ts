import type {
  DataFrame,
  ColumnType,
  UUID,
  Field,
  TableColumn,
  SourceSchema,
} from "@dashframe/dataframe";
import { DataFrame as DataFrameClass } from "@dashframe/dataframe";
import { tableFromArrays, tableToIPC } from "apache-arrow";

/**
 * Represents CSV data as an array of string arrays.
 * First array contains headers, subsequent arrays contain data rows.
 * Can be either a 2D array or a 1D array (for single row data).
 */
export type CSVData = string[][] | string[];

/**
 * Infer column type from a sample value
 */
const inferType = (value: string): ColumnType => {
  if (!value?.length) return "unknown";
  if (!Number.isNaN(Number(value))) return "number";
  if (value === "true" || value === "false") return "boolean";
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return "date";
  return "string";
};

/**
 * Parse a raw CSV cell value into the appropriate typed value
 */
const parseValue = (raw: string | undefined, type: ColumnType): unknown => {
  if (raw === undefined || raw === "") {
    return null;
  }

  switch (type) {
    case "number": {
      const numeric = Number(raw);
      return Number.isNaN(numeric) ? null : numeric;
    }
    case "boolean":
      return raw === "true";
    case "date":
      return new Date(raw).toISOString();
    default:
      return raw;
  }
};

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

  if (!data.length) {
    throw new Error("CSV data is empty");
  }

  const [header, ...rawRows] = data;
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
      type: inferType(sampleValue),
    };
  });

  // Detect ID column by name pattern (matches: id, _id, ID, Id, etc.)
  const detectedIdColumn = userColumns.find((col) => /^_?id$/i.test(col.name));
  const primaryKey = detectedIdColumn ? detectedIdColumn.name : "_rowIndex";

  // Create rows with parsed values
  const rows = rowsData.map((row, index) =>
    header.reduce<Record<string, unknown>>(
      (acc, key, colIndex) => {
        const column = userColumns[colIndex];
        acc[key] = parseValue(row[colIndex], column.type);
        return acc;
      },
      { _rowIndex: index },
    ),
  );

  // Step 2: Build source schema (no _rowIndex in source - it's computed)
  const columns: TableColumn[] = userColumns.map((col) => ({
    name: col.name,
    type: col.type,
  }));

  const sourceSchema: SourceSchema = {
    columns,
    version: 1,
    lastSyncedAt: Date.now(),
  };

  // Step 3: Auto-generate fields (including _rowIndex computed field)
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

  // Step 4: Convert to Arrow table (include _rowIndex for queries)
  const columnNames = ["_rowIndex", ...userColumns.map((col) => col.name)];
  const arrays = columnNames.reduce(
    (acc, col) => {
      acc[col] = rows.map((row) => row[col]);
      return acc;
    },
    {} as Record<string, unknown[]>,
  );

  const arrowTable = tableFromArrays(arrays);
  const ipcBuffer = tableToIPC(arrowTable);

  // Step 5: Create DataFrame with IndexedDB storage
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
