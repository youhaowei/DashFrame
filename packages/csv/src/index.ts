import type { Field, SourceSchema, UUID } from "@dashframe/engine-browser";
import {
  createArrowIPCBufferFromRows,
  createFieldsFromColumns,
  createSourceSchema,
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
 * - arrowBuffer: Arrow IPC bytes for server-owned ingestion
 * - fields: Field definitions for the columns
 * - sourceSchema: Source column metadata
 * - rowCount: Number of data rows (for metadata)
 * - columnCount: Number of columns (for metadata)
 */
export interface CSVConversionResult {
  /** Arrow IPC bytes for server-owned local connector ingestion. */
  arrowBuffer: Uint8Array;
  primaryKey?: string | string[];
  /** Field definitions */
  fields: Field[];
  /** Source schema metadata */
  sourceSchema: SourceSchema;
  /** Row count for metadata */
  rowCount: number;
  /** Column count for metadata */
  columnCount: number;
}

const ZONELESS_ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_OFFSET = /[+-]\d{2}:?\d{2}$/;

function isValidIsoDate(raw: string): boolean {
  if (!ISO_DATE.test(raw)) return false;
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(raw);
}

function isValidZonelessIsoDateTime(raw: string): boolean {
  if (!ZONELESS_ISO_DATE_TIME.test(raw)) return false;
  const separatorIndex = raw.search(/[T ]/);
  const datePart = raw.slice(0, separatorIndex);
  const timeParts = raw.slice(separatorIndex + 1).split(":");
  const hour = Number(timeParts[0]);
  const minute = Number(timeParts[1]);
  const second = Number(timeParts[2] ?? "0");
  return (
    isValidIsoDate(datePart) &&
    Number.isInteger(hour) &&
    hour >= 0 &&
    hour <= 23 &&
    Number.isInteger(minute) &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second < 60
  );
}

function isIsoDateOrDateTime(raw: string): boolean {
  if (ISO_DATE.test(raw)) return isValidIsoDate(raw);
  if (ZONELESS_ISO_DATE_TIME.test(raw)) {
    return isValidZonelessIsoDateTime(raw);
  }
  const zoneless = raw.endsWith("Z")
    ? raw.slice(0, -1)
    : raw.replace(ISO_OFFSET, "");
  return zoneless !== raw && isValidZonelessIsoDateTime(zoneless);
}

function inferCsvStringColumnType(raw: string | undefined): Field["type"] {
  const type = inferStringColumnType(raw);
  if (type !== "date" || raw === undefined) return type;
  return isIsoDateOrDateTime(raw) ? "date" : "string";
}

function inferCsvColumnType(
  rows: string[][],
  columnIndex: number,
): Field["type"] {
  let inferredType: Field["type"] = "unknown";

  for (const row of rows) {
    const raw = row[columnIndex];
    if (raw === undefined || raw === "") continue;

    const valueType = inferCsvStringColumnType(raw);
    if (inferredType === "unknown") {
      inferredType = valueType;
    } else if (valueType !== inferredType) {
      return "string";
    }
  }

  return inferredType;
}

function parseCsvStringValue(
  raw: string | undefined,
  type: Field["type"],
): unknown {
  const normalized =
    type === "date" && raw !== undefined && ZONELESS_ISO_DATE_TIME.test(raw)
      ? `${raw.replace(" ", "T")}Z`
      : raw;
  return parseStringValueByType(normalized, type);
}

/**
 * Converts CSV data into Arrow IPC plus structural metadata.
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
    return {
      name,
      type: inferCsvColumnType(rowsData, index),
    };
  });

  const primaryKey = detectPrimaryKeyColumn(userColumns);

  // Create rows with parsed values
  const rows = rowsData.map((row) =>
    header.reduce<Record<string, unknown>>((acc, key, colIndex) => {
      const column = userColumns[colIndex];
      if (column) acc[key] = parseCsvStringValue(row[colIndex], column.type);
      return acc;
    }, {}),
  );

  const sourceSchema: SourceSchema = createSourceSchema(userColumns);
  const fields: Field[] = createFieldsFromColumns(userColumns, dataTableId);
  const ipcBuffer = createArrowIPCBufferFromRows(rows, userColumns);

  return {
    arrowBuffer: ipcBuffer,
    primaryKey,
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
