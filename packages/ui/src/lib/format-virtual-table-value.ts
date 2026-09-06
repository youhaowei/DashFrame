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
// ECMA-262 rejects the negative-zero expanded year: `-000000` names no date.
const NEGATIVE_ZERO_YEAR = "-000000";

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function formatCalendarDate(
  year: number,
  month: number,
  day: number,
): string | null {
  if (month < 1 || month > 12) return null;

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
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

  const displayYear = `${year < 0 ? "-" : ""}${String(Math.abs(year)).padStart(4, "0")}`;
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

const DATE_ONLY = /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP =
  /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}[ Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const CALENDAR_PREFIX = /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})(?=$|[ TtZz])/;

function isValidCalendarPrefix(match: RegExpExecArray): boolean {
  if (match[1] === NEGATIVE_ZERO_YEAR) return false;
  return (
    formatCalendarDate(Number(match[1]), Number(match[2]), Number(match[3])) !==
    null
  );
}

// Match packages/engine-server/src/arrow-encode.ts for ISO timestamps:
// a missing zone means UTC; preserve explicit zones and expand hour-only
// offsets. Legacy free-form strings retain Date.parse's host-dependent
// interpretation; only ISO input has a deterministic parsing contract.
function normalizeIsoTimestamp(value: string): string {
  const normalized = value.replace(/[ t]/, "T");
  const zone = normalized.match(ZONE_DESIGNATOR)?.[1];
  if (zone == null) return `${normalized}Z`;
  if (HOUR_ONLY_OFFSET.test(zone)) return `${normalized}:00`;
  return normalized;
}

function parseInstant(value: string): Date | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

// Date.parse's legacy parser reads a four-digit year 0000-0099 as a two-digit
// one, so `0001-01-01 00:00:00 UTC` becomes 2001 and `0004-02-29 ...`
// degenerates entirely. The ISO calendar prefix carries the authoritative
// year, so parse with a leap-compatible stand-in — same month lengths, same
// fixed zone-name offsets — and shift the instant back by whole years.
function parseLegacyTimestamp(
  value: string,
  yearText: string | undefined,
): Date | null {
  if (yearText === undefined || yearText.length !== 4)
    return parseInstant(value);

  const year = Number(yearText);
  if (year >= 100) return parseInstant(value);

  const standInYear = isLeapYear(year) ? 2000 : 2001;
  const date = parseInstant(`${standInYear}${value.slice(4)}`);
  date?.setUTCFullYear(date.getUTCFullYear() - (standInYear - year));
  return date;
}

export function formatDateValue(value: unknown): string | null {
  if (typeof value === "number") {
    return formatInstantDate(new Date(value));
  }

  if (value instanceof Date) return formatInstantDate(value);

  if (typeof value !== "string") return null;

  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    if (!isValidCalendarPrefix(dateOnly)) return null;
    return formatCalendarDate(
      Number(dateOnly[1]),
      Number(dateOnly[2]),
      Number(dateOnly[3]),
    );
  }

  const calendarPrefix = CALENDAR_PREFIX.exec(value);
  if (calendarPrefix && !isValidCalendarPrefix(calendarPrefix)) return null;

  const date = ISO_TIMESTAMP.test(value.replace(ZONE_DESIGNATOR, ""))
    ? parseInstant(normalizeIsoTimestamp(value))
    : parseLegacyTimestamp(value, calendarPrefix?.[1]);

  return date ? formatInstantDate(date) : null;
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
