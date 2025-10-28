import type { ParseResult } from "papaparse";
import type { DataFrame } from "@dashframe/types";

export type ColumnType = DataFrame["columns"][number]["type"];

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

export const buildDataFrame = (
  records: ParseResult<string>["data"],
): DataFrame => {
  if (!records.length) {
    return { columns: [], rows: [] };
  }

  const [header, ...rawRows] = records as unknown as string[][];
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
