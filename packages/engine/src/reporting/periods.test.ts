import { describe, expect, test } from "bun:test";

import {
  absoluteDateRange,
  calculateChange,
  previousPeriod,
  previousYear,
  resolveRelativeDateRange,
} from "./periods";

const iso = (value: Date): string => value.toISOString();

const expectRange = (
  range: { start: Date; end: Date },
  start: string,
  end: string,
): void => {
  expect(iso(range.start)).toBe(start);
  expect(iso(range.end)).toBe(end);
};

describe("absoluteDateRange", () => {
  test("copies a finite, increasing inclusive/exclusive range", () => {
    const start = new Date("2024-01-01T00:00:00.000Z");
    const end = new Date("2024-02-01T00:00:00.000Z");
    const range = absoluteDateRange(start, end);

    start.setUTCFullYear(2030);
    end.setUTCFullYear(2030);

    expectRange(range, "2024-01-01T00:00:00.000Z", "2024-02-01T00:00:00.000Z");
  });

  test("allows an empty range but rejects reversed and invalid ranges", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");

    expect(absoluteDateRange(date, date)).toEqual({ start: date, end: date });
    expect(() => absoluteDateRange(new Date("2024-02-01"), date)).toThrow();
    expect(() => absoluteDateRange(new Date(Number.NaN), date)).toThrow();
  });
});

describe("resolveRelativeDateRange", () => {
  const asOf = new Date("2024-05-15T12:34:56.789Z");

  test.each([
    ["this_month", "2024-05-01T00:00:00.000Z", "2024-06-01T00:00:00.000Z"],
    ["previous_month", "2024-04-01T00:00:00.000Z", "2024-05-01T00:00:00.000Z"],
    ["this_quarter", "2024-04-01T00:00:00.000Z", "2024-07-01T00:00:00.000Z"],
    [
      "previous_quarter",
      "2024-01-01T00:00:00.000Z",
      "2024-04-01T00:00:00.000Z",
    ],
    ["this_year", "2024-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z"],
    ["previous_year", "2023-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z"],
  ] as const)("resolves %s on UTC calendar boundaries", (type, start, end) => {
    expectRange(resolveRelativeDateRange({ type }, asOf), start, end);
  });

  test("resolves last complete days across a leap-day boundary", () => {
    expectRange(
      resolveRelativeDateRange(
        { type: "last_complete_days", count: 3 },
        new Date("2024-03-02T16:00:00.000Z"),
      ),
      "2024-02-28T00:00:00.000Z",
      "2024-03-02T00:00:00.000Z",
    );
  });

  test("uses Monday UTC boundaries for complete weeks", () => {
    expectRange(
      resolveRelativeDateRange(
        { type: "last_complete_weeks", count: 2 },
        new Date("2024-01-07T23:59:59.000Z"),
      ),
      "2023-12-18T00:00:00.000Z",
      "2024-01-01T00:00:00.000Z",
    );
  });

  test("resolves complete months over unequal month lengths", () => {
    expectRange(
      resolveRelativeDateRange(
        { type: "last_complete_months", count: 2 },
        new Date("2024-03-31T23:00:00.000Z"),
      ),
      "2024-01-01T00:00:00.000Z",
      "2024-03-01T00:00:00.000Z",
    );
  });

  test.each([
    ["month_to_date", "2024-05-01T00:00:00.000Z"],
    ["year_to_date", "2024-01-01T00:00:00.000Z"],
  ] as const)(
    "keeps the injected instant as the exclusive end for %s",
    (type, start) => {
      expectRange(resolveRelativeDateRange({ type }, asOf), start, iso(asOf));
    },
  );

  test("allows an empty to-date range at an exact UTC period boundary", () => {
    const boundary = new Date("2024-01-01T00:00:00.000Z");

    expectRange(
      resolveRelativeDateRange({ type: "month_to_date" }, boundary),
      boundary.toISOString(),
      boundary.toISOString(),
    );
    expectRange(
      resolveRelativeDateRange({ type: "year_to_date" }, boundary),
      boundary.toISOString(),
      boundary.toISOString(),
    );
  });

  test("rejects invalid counts and asOf dates", () => {
    expect(() =>
      resolveRelativeDateRange({ type: "last_complete_days", count: 0 }, asOf),
    ).toThrow();
    expect(() =>
      resolveRelativeDateRange({ type: "this_month" }, new Date(Number.NaN)),
    ).toThrow();
  });
});

describe("comparison periods", () => {
  test("uses the preceding calendar month for a whole month", () => {
    expectRange(
      previousPeriod(
        absoluteDateRange(new Date("2024-03-01"), new Date("2024-04-01")),
      ),
      "2024-02-01T00:00:00.000Z",
      "2024-03-01T00:00:00.000Z",
    );
  });

  test("uses preceding calendar boundaries for whole quarters and years", () => {
    expectRange(
      previousPeriod(
        absoluteDateRange(new Date("2024-01-01"), new Date("2024-04-01")),
      ),
      "2023-10-01T00:00:00.000Z",
      "2024-01-01T00:00:00.000Z",
    );
    expectRange(
      previousPeriod(
        absoluteDateRange(new Date("2024-01-01"), new Date("2025-01-01")),
      ),
      "2023-01-01T00:00:00.000Z",
      "2024-01-01T00:00:00.000Z",
    );
  });

  test("compares complete multi-month ranges with the same number of calendar months", () => {
    const current = resolveRelativeDateRange(
      { type: "last_complete_months", count: 2 },
      new Date("2026-03-15T00:00:00Z"),
    );
    expectRange(
      previousPeriod(current),
      "2025-11-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    expectRange(
      previousPeriod(
        absoluteDateRange(new Date("2024-01-01"), new Date("2026-01-01")),
      ),
      "2022-01-01T00:00:00.000Z",
      "2024-01-01T00:00:00.000Z",
    );
  });

  test("uses equal elapsed duration for an arbitrary range", () => {
    expectRange(
      previousPeriod(
        absoluteDateRange(
          new Date("2024-03-10T06:00:00.000Z"),
          new Date("2024-03-20T18:00:00.000Z"),
        ),
      ),
      "2024-02-28T18:00:00.000Z",
      "2024-03-10T06:00:00.000Z",
    );
  });

  test("shifts to the previous year and clamps leap day", () => {
    expectRange(
      previousYear(
        absoluteDateRange(
          new Date("2024-02-29T08:30:00.000Z"),
          new Date("2024-03-01T08:30:00.000Z"),
        ),
      ),
      "2023-02-28T08:30:00.000Z",
      "2023-03-01T08:30:00.000Z",
    );
  });
});

describe("calculateChange", () => {
  test("returns absolute and conventional baseline-relative percent change", () => {
    expect(calculateChange(125, 100)).toEqual({ absolute: 25, percent: 25 });
    expect(calculateChange(75, 100)).toEqual({ absolute: -25, percent: -25 });
  });

  test("returns a null percentage for zero or absent baselines", () => {
    expect(calculateChange(5, 0)).toEqual({ absolute: 5, percent: null });
    expect(calculateChange(5, null)).toEqual({ absolute: null, percent: null });
    expect(calculateChange(null, 5)).toEqual({ absolute: null, percent: null });
  });

  test("rejects non-finite values even when the other value is absent", () => {
    expect(() => calculateChange(Number.NaN, null)).toThrow();
    expect(() => calculateChange(5, Number.POSITIVE_INFINITY)).toThrow();
  });
});
