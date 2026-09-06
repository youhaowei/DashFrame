import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { defaultFormatValue } from "./format-virtual-table-value";

// Date-only values must keep their calendar day in a zone behind UTC, so the
// assertions below are only meaningful with the zone pinned. Restore the
// original afterwards — this process is shared with the other test files in
// the worker, and a leaked TZ would silently change their local-time results.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Phoenix";
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("defaultFormatValue", () => {
  it("keeps a string-typed version value as text", () => {
    expect(defaultFormatValue("1.5", "string")).toBe("1.5");
  });

  it("keeps a string-typed year as text", () => {
    expect(defaultFormatValue("2024", "string")).toBe("2024");
  });

  it("does not automatically convert ISO-looking strings", () => {
    expect(defaultFormatValue("2024-03-15", "string")).toBe("2024-03-15");
    expect(defaultFormatValue("2024-01", "string")).toBe("2024-01");
  });

  // VirtualTable's async mode infers columns as `{ name }` with no `type`
  // (see VirtualTable.tsx), so an untyped column is the common production
  // path — it must never coerce a string into a date either.
  it("never coerces strings when the column type is absent or unknown", () => {
    expect(defaultFormatValue("2024-03-15")).toBe("2024-03-15");
    expect(defaultFormatValue("1.5")).toBe("1.5");
    expect(defaultFormatValue("2024-03-15", "unknown")).toBe("2024-03-15");
  });

  it("formats date-only strings from their calendar parts", () => {
    expect(defaultFormatValue("2024-03-15", "date")).toBe("Mar 15, 2024");
    expect(defaultFormatValue("0000-01-01", "date")).toBe("Jan 1, 0000");
    expect(defaultFormatValue("0001-01-01", "date")).toBe("Jan 1, 0001");
  });

  it("validates date-only strings without consulting the host timezone", () => {
    const previousTz = process.env.TZ;
    process.env.TZ = "Pacific/Apia";
    try {
      expect(defaultFormatValue("2011-12-30", "date")).toBe("Dec 30, 2011");
    } finally {
      process.env.TZ = previousTz;
    }
  });

  it("formats numeric epoch values in date columns as UTC calendar dates", () => {
    expect(defaultFormatValue(Date.UTC(2024, 0, 18), "date")).toBe(
      "Jan 18, 2024",
    );
  });

  it("preserves early years after Arrow converts dates to epoch values", () => {
    expect(defaultFormatValue(Date.parse("0000-01-01T00:00:00Z"), "date")).toBe(
      "Jan 1, 0000",
    );
    expect(defaultFormatValue(Date.parse("0001-01-01T00:00:00Z"), "date")).toBe(
      "Jan 1, 0001",
    );
  });

  it("keeps negative year signs before padded digits", () => {
    expect(
      defaultFormatValue(Date.parse("-000005-06-15T00:00:00Z"), "date"),
    ).toBe("Jun 15, -0005");
  });

  it("preserves host Date.parse interpretation for legacy non-ISO strings", () => {
    expect(defaultFormatValue("March 15, 2024 23:30", "date")).toBe(
      "Mar 16, 2024",
    );
    expect(defaultFormatValue("March 15, 2024 10:30", "date")).toBe(
      "Mar 15, 2024",
    );
    expect(defaultFormatValue("03/15/2024 10:30:00", "date")).toBe(
      "Mar 15, 2024",
    );
  });

  it("parses expanded ISO years as UTC and validates their calendar dates", () => {
    expect(defaultFormatValue("+010000-01-01T23:30:00", "date")).toBe(
      "Jan 1, 10000",
    );
    expect(defaultFormatValue("-000005-06-15T23:30:00", "date")).toBe(
      "Jun 15, -0005",
    );
    expect(defaultFormatValue("+010000-02-30T00:00:00Z", "date")).toBe(
      "+010000-02-30T00:00:00Z",
    );
  });

  it("preserves Date.parse-compatible named zones", () => {
    expect(defaultFormatValue("2024-01-01 12:00:00 UTC", "date")).toBe(
      "Jan 1, 2024",
    );
  });

  // Date.parse's legacy parser remaps years 0000-0099 onto 1900/2000, so a
  // named-zone timestamp must not inherit that century shift.
  it("preserves early years in named-zone timestamps", () => {
    expect(defaultFormatValue("0001-01-01 00:00:00 UTC", "date")).toBe(
      "Jan 1, 0001",
    );
    expect(defaultFormatValue("0099-01-01 00:00:00 UTC", "date")).toBe(
      "Jan 1, 0099",
    );
    expect(defaultFormatValue("0004-02-29 12:00:00 UTC", "date")).toBe(
      "Feb 29, 0004",
    );
    expect(defaultFormatValue("0000-12-31 23:00:00 EST", "date")).toBe(
      "Jan 1, 0001",
    );
    expect(defaultFormatValue("0001-01-01 00:00:00 GMT+0200", "date")).toBe(
      "Dec 31, 0000",
    );
  });

  it("rejects the negative-zero expanded year", () => {
    expect(defaultFormatValue("-000000-01-01", "date")).toBe("-000000-01-01");
    expect(defaultFormatValue("-000000-01-01T00:00:00Z", "date")).toBe(
      "-000000-01-01T00:00:00Z",
    );
    expect(defaultFormatValue("-000000-01-01 00:00:00 UTC", "date")).toBe(
      "-000000-01-01 00:00:00 UTC",
    );
    expect(defaultFormatValue("+000000-01-01", "date")).toBe("Jan 1, 0000");
  });

  it("honors explicit and hour-only offsets across UTC date boundaries", () => {
    expect(defaultFormatValue("2024-01-01 00:00:00-07", "date")).toBe(
      "Jan 1, 2024",
    );
    expect(defaultFormatValue("2024-01-31T20:00:00-05:00", "date")).toBe(
      "Feb 1, 2024",
    );
  });

  it("renders the same instant consistently across supported representations", () => {
    const instant = "2024-01-18T00:00:00.000Z";
    const expected = "Jan 18, 2024";

    expect(defaultFormatValue(Date.parse(instant), "date")).toBe(expected);
    expect(defaultFormatValue(new Date(instant), "date")).toBe(expected);
    expect(defaultFormatValue(instant, "date")).toBe(expected);
  });

  it("treats zone-less timestamps as UTC", () => {
    expect(defaultFormatValue("2024-01-18T23:30:00", "date")).toBe(
      "Jan 18, 2024",
    );
  });

  it("leaves an impossible calendar date as text rather than rolling it over", () => {
    expect(defaultFormatValue("2024-02-30", "date")).toBe("2024-02-30");
    expect(defaultFormatValue("2024-02-30Z", "date")).toBe("2024-02-30Z");
    expect(defaultFormatValue("2024-02-30t00:00:00z", "date")).toBe(
      "2024-02-30t00:00:00z",
    );
    expect(defaultFormatValue("2024-02-29t23:30:00", "date")).toBe(
      "Feb 29, 2024",
    );
    expect(defaultFormatValue("2024-02-30T00:00:00Z", "date")).toBe(
      "2024-02-30T00:00:00Z",
    );
  });

  it("renders null and undefined as the empty placeholder", () => {
    expect(defaultFormatValue(null, "date")).toBe("—");
    expect(defaultFormatValue(undefined, "string")).toBe("—");
  });

  it("keeps local Date rendering outside declared date columns", () => {
    const localEvening = new Date(2024, 0, 18, 20);

    expect(defaultFormatValue(localEvening, "string")).toBe("Jan 18, 2024");
    expect(defaultFormatValue(localEvening, "date")).toBe("Jan 19, 2024");
  });

  it("continues to format numbers", () => {
    expect(defaultFormatValue(1.5, "number")).toBe("1.5");
  });
});
