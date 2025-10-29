import type { DataFrame, ColumnType } from "@dash-frame/dataframe";

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
    return { columns: [], rows: [] };
  }

  const [header, ...rawRows] = data;
  const rowsData = rawRows.filter((row) =>
    row.some((cell) => cell !== undefined && cell !== ""),
  );

  const columns = header.map((name, index) => {
    const sampleValue =
      rowsData.find((row) => row[index] !== undefined && row[index] !== "")?.[
        index
      ] ?? "";
    return {
      name,
      type: inferType(sampleValue),
    };
  });

  const rows = rowsData.map((row) =>
    header.reduce<Record<string, unknown>>((acc, key, index) => {
      const column = columns[index];
      acc[key] = parseValue(row[index], column.type);
      return acc;
    }, {}),
  );

  return { columns, rows };
};
