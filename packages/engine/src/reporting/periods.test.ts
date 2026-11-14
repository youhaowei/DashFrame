import { describe, expect, test } from "bun:test";

import {
  absoluteDateRange,
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

  test.each([
    [
      "resolves last complete days across a leap-day boundary",
      { type: "last_complete_days", count: 3 },
      "2024-03-02T16:00:00.000Z",
      "2024-02-28T00:00:00.000Z",
      "2024-03-02T00:00:00.000Z",
    ],
    [
      "uses Monday UTC boundaries for complete weeks",
      { type: "last_complete_weeks", count: 2 },
      "2024-01-07T23:59:59.000Z",
      "2023-12-18T00:00:00.000Z",
      "2024-01-01T00:00:00.000Z",
    ],
    [
      "resolves complete months over unequal month lengths",
      { type: "last_complete_months", count: 2 },
      "2024-03-31T23:00:00.000Z",
      "2024-01-01T00:00:00.000Z",
      "2024-03-01T00:00:00.000Z",
    ],
  ] as const)("%s", (_label, range, at, start, end) => {
    expectRange(resolveRelativeDateRange(range, new Date(at)), start, end);
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
