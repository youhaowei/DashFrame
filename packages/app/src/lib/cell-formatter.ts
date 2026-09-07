import type { ColumnType } from "@dashframe/types";
import { formatDateValue } from "@dashframe/ui";

/**
 * Format a cell value based on the column's declared type.
 *
 * Keys off the column's ColumnType, NOT the JS runtime type of the value.
 * This is deliberate: date columns carry epoch-millisecond numbers from DuckDB
 * and must be formatted by type declaration, not by `typeof value`.
 *
 * Supported types:
 * - "date" → human-readable UTC calendar date
 * - everything else → default string coercion (null/undefined → "—")
 */
export function formatCellValue(value: unknown, type: ColumnType): string {
  if (value === null || value === undefined) return "—";

  if (type === "date") {
    return formatDateValue(value) ?? "—";
  }

  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
