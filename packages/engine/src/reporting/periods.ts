/**
 * A bounded UTC instant range. `start` is inclusive and `end` is exclusive.
 * Dates are copied when a range is created so later caller mutation cannot
 * change the range.
 */
export interface AbsoluteDateRange {
  readonly start: Date;
  readonly end: Date;
}

export type RelativeDateRange =
  | { readonly type: "this_month" }
  | { readonly type: "previous_month" }
  | { readonly type: "this_quarter" }
  | { readonly type: "previous_quarter" }
  | { readonly type: "this_year" }
  | { readonly type: "previous_year" }
  | { readonly type: "last_complete_days"; readonly count: number }
  | { readonly type: "last_complete_weeks"; readonly count: number }
  | { readonly type: "last_complete_months"; readonly count: number }
  | { readonly type: "month_to_date" }
  | { readonly type: "year_to_date" };

export interface Change {
  /** Current value minus baseline, or `null` when either value is absent. */
  readonly absolute: number | null;
  /**
   * `(current - baseline) / baseline * 100`, or `null` when either value is
   * absent or the baseline is zero.
   */
  readonly percent: number | null;
}

const assertFiniteDate = (value: Date, name: string): void => {
  if (!Number.isFinite(value.getTime())) {
    throw new RangeError(`${name} must be a valid Date`);
  }
};

const utcDate = (
  year: number,
  month: number,
  day = 1,
  hours = 0,
  minutes = 0,
  seconds = 0,
  milliseconds = 0,
): Date => {
  const value = new Date(0);
  value.setUTCFullYear(year, month, day);
  value.setUTCHours(hours, minutes, seconds, milliseconds);
  return value;
};

const startOfUtcDay = (value: Date): Date =>
  utcDate(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

const startOfUtcMonth = (value: Date): Date =>
  utcDate(value.getUTCFullYear(), value.getUTCMonth());

const startOfUtcQuarter = (value: Date): Date =>
  utcDate(value.getUTCFullYear(), Math.floor(value.getUTCMonth() / 3) * 3);

const startOfUtcYear = (value: Date): Date =>
  utcDate(value.getUTCFullYear(), 0);

const addUtcDays = (value: Date, count: number): Date =>
  utcDate(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate() + count,
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds(),
  );

const addUtcMonths = (value: Date, count: number): Date =>
  utcDate(
    value.getUTCFullYear(),
    value.getUTCMonth() + count,
    value.getUTCDate(),
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds(),
  );

const startOfUtcWeek = (value: Date): Date => {
  const day = startOfUtcDay(value);
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  return addUtcDays(day, -daysSinceMonday);
};

const assertPositiveCount = (count: number): void => {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new RangeError("count must be a positive safe integer");
  }
};

/** Creates a validated range and defensively copies both dates. */
export const absoluteDateRange = (
  start: Date,
  end: Date,
): AbsoluteDateRange => {
  assertFiniteDate(start, "start");
  assertFiniteDate(end, "end");
  if (start.getTime() > end.getTime()) {
    throw new RangeError("start must not be after end");
  }
  return { start: new Date(start), end: new Date(end) };
};

/**
 * Resolves a calendar-relative range using only the supplied `asOf` instant.
 * All boundaries use UTC; weeks start on Monday. "Complete" ranges exclude
 * the current partial day, week, or month. To-date ranges end at `asOf`.
 */
export const resolveRelativeDateRange = (
  relative: RelativeDateRange,
  asOf: Date,
): AbsoluteDateRange => {
  assertFiniteDate(asOf, "asOf");

  switch (relative.type) {
    case "this_month": {
      const start = startOfUtcMonth(asOf);
      return absoluteDateRange(start, addUtcMonths(start, 1));
    }
    case "previous_month": {
      const end = startOfUtcMonth(asOf);
      return absoluteDateRange(addUtcMonths(end, -1), end);
    }
    case "this_quarter": {
      const start = startOfUtcQuarter(asOf);
      return absoluteDateRange(start, addUtcMonths(start, 3));
    }
    case "previous_quarter": {
      const end = startOfUtcQuarter(asOf);
      return absoluteDateRange(addUtcMonths(end, -3), end);
    }
    case "this_year": {
      const start = startOfUtcYear(asOf);
      return absoluteDateRange(start, utcDate(start.getUTCFullYear() + 1, 0));
    }
    case "previous_year": {
      const end = startOfUtcYear(asOf);
      return absoluteDateRange(utcDate(end.getUTCFullYear() - 1, 0), end);
    }
    case "last_complete_days": {
      assertPositiveCount(relative.count);
      const end = startOfUtcDay(asOf);
      return absoluteDateRange(addUtcDays(end, -relative.count), end);
    }
    case "last_complete_weeks": {
      assertPositiveCount(relative.count);
      const end = startOfUtcWeek(asOf);
      return absoluteDateRange(addUtcDays(end, -7 * relative.count), end);
    }
    case "last_complete_months": {
      assertPositiveCount(relative.count);
      const end = startOfUtcMonth(asOf);
      return absoluteDateRange(addUtcMonths(end, -relative.count), end);
    }
    case "month_to_date":
      return absoluteDateRange(startOfUtcMonth(asOf), asOf);
    case "year_to_date":
      return absoluteDateRange(startOfUtcYear(asOf), asOf);
  }
};

const isSameInstant = (left: Date, right: Date): boolean =>
  left.getTime() === right.getTime();

const isWholeUtcMonth = (range: AbsoluteDateRange): boolean =>
  isSameInstant(range.start, startOfUtcMonth(range.start)) &&
  isSameInstant(range.end, addUtcMonths(range.start, 1));

const isWholeUtcQuarter = (range: AbsoluteDateRange): boolean =>
  isSameInstant(range.start, startOfUtcQuarter(range.start)) &&
  isSameInstant(range.end, addUtcMonths(range.start, 3));

const isWholeUtcYear = (range: AbsoluteDateRange): boolean =>
  isSameInstant(range.start, startOfUtcYear(range.start)) &&
  isSameInstant(range.end, utcDate(range.start.getUTCFullYear() + 1, 0));

/**
 * Returns the immediately preceding comparison period. Exact whole UTC
 * months, quarters, and years move by one calendar unit, preserving calendar
 * boundaries even when durations differ. Every other range moves backward by
 * its exact elapsed duration.
 */
export const previousPeriod = (range: AbsoluteDateRange): AbsoluteDateRange => {
  const validated = absoluteDateRange(range.start, range.end);
  if (isWholeUtcYear(validated)) {
    return absoluteDateRange(
      utcDate(validated.start.getUTCFullYear() - 1, 0),
      validated.start,
    );
  }
  if (isWholeUtcQuarter(validated)) {
    return absoluteDateRange(
      addUtcMonths(validated.start, -3),
      validated.start,
    );
  }
  if (isWholeUtcMonth(validated)) {
    return absoluteDateRange(
      addUtcMonths(validated.start, -1),
      validated.start,
    );
  }

  const duration = validated.end.getTime() - validated.start.getTime();
  return absoluteDateRange(
    new Date(validated.start.getTime() - duration),
    validated.start,
  );
};

const shiftPreviousUtcYear = (value: Date): Date => {
  const targetYear = value.getUTCFullYear() - 1;
  const lastDayOfTargetMonth = utcDate(
    targetYear,
    value.getUTCMonth() + 1,
    0,
  ).getUTCDate();
  return utcDate(
    targetYear,
    value.getUTCMonth(),
    Math.min(value.getUTCDate(), lastDayOfTargetMonth),
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds(),
  );
};

/**
 * Moves both boundaries back one UTC calendar year. A boundary on February 29
 * is clamped to February 28 when the target year is not a leap year.
 */
export const previousYear = (range: AbsoluteDateRange): AbsoluteDateRange => {
  const validated = absoluteDateRange(range.start, range.end);
  return absoluteDateRange(
    shiftPreviousUtcYear(validated.start),
    shiftPreviousUtcYear(validated.end),
  );
};

const assertFiniteMetric = (
  value: number | null | undefined,
  name: string,
): void => {
  if (value !== null && value !== undefined && !Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite when present`);
  }
};

/** Calculates absolute and percentage change without inventing missing data. */
export const calculateChange = (
  current: number | null | undefined,
  baseline: number | null | undefined,
): Change => {
  assertFiniteMetric(current, "current");
  assertFiniteMetric(baseline, "baseline");
  if (
    current === null ||
    current === undefined ||
    baseline === null ||
    baseline === undefined
  ) {
    return { absolute: null, percent: null };
  }

  const absolute = current - baseline;
  return {
    absolute,
    percent: baseline === 0 ? null : (absolute / baseline) * 100,
  };
};
