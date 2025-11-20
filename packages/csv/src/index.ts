import type {
  DataFrame,
  ColumnType,
  UUID,
  Field,
  TableColumn,
  SourceSchema
} from "@dashframe/dataframe";

/**
 * Represents CSV data as an array of string arrays.
 * First array contains headers, subsequent arrays contain data rows.
 * Can be either a 2D array or a 1D array (for single row data).
 */
export type CSVData = string[][] | string[];

const inferType = (value: string): ColumnType => {
  if (!value?.length) return "unknown";
  if (!Number.isNaN(Number(value))) return "number";
  if (value === "true" || value === "false") return "boolean";
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return "date";
  return "string";
};

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
 * Converts CSV data into a DataFrame structure.
 * Expects the first row to contain headers and subsequent rows to contain data.
 */
export const csvToDataFrame = (csvData: CSVData): DataFrame => {
  // Handle case where csvData might be a single row array
  const data = Array.isArray(csvData[0])
    ? (csvData as string[][])
    : [csvData as string[]];

  if (!data.length) {
    return { fieldIds: [], columns: [], rows: [] };
  }

  const [header, ...rawRows] = data;
  const rowsData = rawRows.filter((row) =>
    row.some((cell) => cell !== undefined && cell !== ""),
  );

  // Create columns from CSV headers
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
  const detectedIdColumn = userColumns.find((col) =>
    /^_?id$/i.test(col.name),
  );

  // Add system columns with _rowIndex first
  const columns = [
    {
      name: "_rowIndex",
      type: "number" as ColumnType,
    },
    ...userColumns,
  ];

  // Create rows with system columns
  const rows = rowsData.map((row, index) =>
    header.reduce<Record<string, unknown>>(
      (acc, key, colIndex) => {
        const column = userColumns[colIndex];
        acc[key] = parseValue(row[colIndex], column.type);
        return acc;
      },
      { _rowIndex: index }, // Start with _rowIndex
    ),
  );

  return {
    fieldIds: [], // Legacy function - use csvToDataFrameWithFields for field-based architecture
    columns,
    primaryKey: detectedIdColumn ? detectedIdColumn.name : "_rowIndex",
    rows,
  };
};

/**
 * Result type for enhanced CSV conversion
 */
export type CsvResult = {
  dataFrame: DataFrame;
  fields: Field[];
  sourceSchema: SourceSchema;
};

/**
 * Converts CSV data into a DataFrame with field metadata.
 * Returns DataFrame, auto-generated fields, and source schema.
 */
export function csvToDataFrameWithFields(
  csvData: CSVData,
  dataTableId: UUID
): CsvResult {
  // Parse CSV using existing logic
  const parsed = csvToDataFrame(csvData);

  // Build source schema (no _rowIndex in source - it's computed)
  const columns: TableColumn[] = (parsed.columns || [])
    .filter(col => col.name !== "_rowIndex")
    .map(col => ({
      name: col.name,
      type: col.type,  // Use inferred type as native type for CSV
    }));

  const sourceSchema: SourceSchema = {
    columns,
    version: 1,
    lastSyncedAt: Date.now()
  };

  // Auto-generate fields (including _rowIndex computed field)
  const fields: Field[] = [
    // System field - computed from array index
    {
      id: crypto.randomUUID(),
      name: "_rowIndex",
      tableId: dataTableId,
      columnName: undefined,  // Computed field
      type: "number"
    },
    // User fields from source
    ...columns.map(col => ({
      id: crypto.randomUUID(),
      name: col.name,
      tableId: dataTableId,
      columnName: col.name,
      type: col.type as ColumnType,
    }))
  ];

  // Build DataFrame with fieldIds
  const dataFrame: DataFrame = {
    fieldIds: fields.map(f => f.id),
    rows: parsed.rows,
    primaryKey: parsed.primaryKey
  };

  return { dataFrame, fields, sourceSchema };
}
