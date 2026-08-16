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
  });

  it("formats numeric epoch values in date columns as UTC calendar dates", () => {
    expect(defaultFormatValue(Date.UTC(2024, 0, 18), "date")).toBe(
      "Jan 18, 2024",
    );
  });

  it("renders the same instant consistently across supported representations", () => {
    const instant = "2024-01-18T00:00:00.000Z";
    const expected = "Jan 18, 2024";

    expect(defaultFormatValue(Date.parse(instant), "date")).toBe(expected);
    expect(defaultFormatValue(new Date(instant), "date")).toBe(expected);
    expect(defaultFormatValue(instant, "date")).toBe(expected);
  });

  it("leaves an impossible calendar date as text rather than rolling it over", () => {
    expect(defaultFormatValue("2024-02-30", "date")).toBe("2024-02-30");
  });

  it("renders null and undefined as the empty placeholder", () => {
    expect(defaultFormatValue(null, "date")).toBe("—");
    expect(defaultFormatValue(undefined, "string")).toBe("—");
  });

  it("continues to format Date objects and numbers", () => {
    expect(defaultFormatValue(new Date(2024, 2, 15), "string")).toBe(
      "Mar 15, 2024",
    );
    expect(defaultFormatValue(1.5, "number")).toBe("1.5");
  });
});
