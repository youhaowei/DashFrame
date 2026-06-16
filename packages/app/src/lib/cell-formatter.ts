import type { ColumnType } from "@dashframe/types";

/**
 * Format a cell value based on the column's declared type.
 *
 * Keys off the column's ColumnType, NOT the JS runtime type of the value.
 * This is deliberate: date columns carry epoch-millisecond numbers from DuckDB
 * and must be formatted by type declaration, not by `typeof value`.
 *
 * Supported types:
 * - "date" → ISO date string (YYYY-MM-DD)
 * - everything else → default string coercion (null/undefined → "—")
 */
export function formatCellValue(value: unknown, type: ColumnType): string {
  if (value === null || value === undefined) return "—";

  if (type === "date") {
    return formatEpochAsDate(value);
  }

  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Format an epoch-millisecond number (or Date/string) as an ISO date string.
 * Returns "—" when the value cannot be parsed as a valid date.
 */
function formatEpochAsDate(value: unknown): string {
  let date: Date;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number") {
    date = new Date(value);
  } else if (typeof value === "string") {
    date = new Date(value);
  } else {
    return "—";
  }

  if (isNaN(date.getTime())) return "—";

  // Use UTC to avoid timezone shifts on bare date values
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
