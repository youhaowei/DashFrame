import type { ColumnType } from "@dashframe/types";
import { formatNumeric } from "./format-numeric";

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const ZONE_DESIGNATOR = /([zZ]|[+-]\d{2}(?::?\d{2})?)$/;
const HOUR_ONLY_OFFSET = /^[+-]\d{2}$/;

function formatCalendarDate(
  year: number,
  month: number,
  day: number,
): string | null {
  if (month < 1 || month > 12) return null;

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1]!;
  if (day < 1 || day > daysInMonth) return null;

  const displayYear = String(year).padStart(4, "0");
  return `${MONTH_NAMES[month - 1]} ${day}, ${displayYear}`;
}

function formatInstantDate(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;

  // Arrow supplies date and timestamp values as instants without preserving
  // their source distinction, so use UTC consistently until timezone policy
  // can be configured at the user and data-source levels.
  return formatCalendarDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
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

  // Match the server's timestamp boundary: a date-time without a zone is UTC,
  // while explicit zones are preserved and hour-only offsets are normalized
  // to a form Date.parse accepts.
  let normalized = value.replace(" ", "T");
  if (normalized.includes("T")) {
    const zone = normalized.match(ZONE_DESIGNATOR)?.[1];
    if (zone == null) normalized += "Z";
    else if (HOUR_ONLY_OFFSET.test(zone)) normalized += ":00";
  }

  const parsed = Date.parse(normalized);
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
