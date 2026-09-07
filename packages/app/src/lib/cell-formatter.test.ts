import { describe, expect, it } from "vite-plus/test";
import { formatCellValue } from "./cell-formatter";

describe("formatCellValue", () => {
  // ── date type ─────────────────────────────────────────────────────────────

  it("formats an epoch-millisecond number for date columns", () => {
    // 2024-01-18T00:00:00.000Z in epoch ms
    expect(formatCellValue(1705536000000, "date")).toBe("Jan 18, 2024");
  });

  it("formats a Date object for date columns", () => {
    const date = new Date("2024-06-15T00:00:00.000Z");
    expect(formatCellValue(date, "date")).toBe("Jun 15, 2024");
  });

  it("formats an ISO date string for date columns", () => {
    expect(formatCellValue("2024-03-25", "date")).toBe("Mar 25, 2024");
    expect(formatCellValue("0000-01-01", "date")).toBe("Jan 1, 0000");
    expect(formatCellValue("0001-01-01", "date")).toBe("Jan 1, 0001");
  });

  it("shares one date contract across supported representations", () => {
    const instant = "2024-01-18T00:00:00.000Z";
    const expected = "Jan 18, 2024";

    expect(formatCellValue(Date.parse(instant), "date")).toBe(expected);
    expect(formatCellValue(new Date(instant), "date")).toBe(expected);
    expect(formatCellValue(instant, "date")).toBe(expected);
  });

  it("returns — for null in a date column", () => {
    expect(formatCellValue(null, "date")).toBe("—");
  });

  it("returns — for undefined in a date column", () => {
    expect(formatCellValue(undefined, "date")).toBe("—");
  });

  it("returns — for an unparseable value in a date column", () => {
    expect(formatCellValue("not-a-date", "date")).toBe("—");
  });

  it("returns — for a boolean value in a date column (non-parseable type)", () => {
    expect(formatCellValue(true, "date")).toBe("—");
  });

  it("returns — for an object value in a date column (non-parseable type)", () => {
    expect(formatCellValue({ a: 1 }, "date")).toBe("—");
  });

  // ── non-date types (the critical guard: keys off type, not value) ──────────

  it("does NOT format a large number as a date when the column type is number", () => {
    // 1705536000000 looks like a date epoch, but the column type is number
    const result = formatCellValue(1705536000000, "number");
    expect(result).toBe("1705536000000");
    // Ensure it was NOT treated as a date
    expect(result).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("passes strings through unchanged for string columns", () => {
    expect(formatCellValue("hello world", "string")).toBe("hello world");
  });

  it("coerces booleans to string for boolean columns", () => {
    expect(formatCellValue(true, "boolean")).toBe("true");
    expect(formatCellValue(false, "boolean")).toBe("false");
  });

  it("returns — for null in a non-date column", () => {
    expect(formatCellValue(null, "string")).toBe("—");
  });

  it("serialises objects as JSON for unknown columns", () => {
    expect(formatCellValue({ a: 1 }, "unknown")).toBe('{"a":1}');
  });
});
