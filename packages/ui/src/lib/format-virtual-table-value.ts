import type { ColumnType } from "@dashframe/types";
import { formatNumeric } from "./format-numeric";

function formatCalendarDate(
  year: number,
  month: number,
  day: number,
): string | null {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDate(value: unknown, type?: ColumnType): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  if (type !== "date" || typeof value !== "string") return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return formatCalendarDate(
      Number(dateOnly[1]),
      Number(dateOnly[2]),
      Number(dateOnly[3]),
    );
  }

  const parsed = Date.parse(value);
  if (!isNaN(parsed)) {
    return new Date(parsed).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  return null;
}

export function defaultFormatValue(value: unknown, type?: ColumnType): string {
  if (value === null || value === undefined) return "—";
  const dateStr = formatDate(value, type);
  if (dateStr) return dateStr;
  if (typeof value === "number") return formatNumeric(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
