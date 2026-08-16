import type { ColumnType } from "@dashframe/types";
import { formatNumeric } from "./format-numeric";

function formatCalendarDate(
  year: number,
  month: number,
  day: number,
): string | null {
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
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

function formatInstantDate(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;

  // Arrow supplies date and timestamp values as instants without preserving
  // their source distinction, so use UTC consistently until timezone policy
  // can be configured at the user and data-source levels.
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateValue(value: unknown): string | null {
  if (typeof value === "number") {
    return formatInstantDate(new Date(value));
  }

  if (value instanceof Date) return formatInstantDate(value);

  if (typeof value !== "string") return null;

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
    return formatInstantDate(new Date(parsed));
  }

  return null;
}

function formatDate(value: unknown, type?: ColumnType): string | null {
  if (type === "date") return formatDateValue(value);

  // Preserve the existing runtime-Date behavior for untyped and non-date
  // columns; the UTC contract applies only when the column declares a date.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleDateString("en-US", {
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
