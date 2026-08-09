import { describe, expect, it } from "vitest";
import { formatCellValue } from "./cell-formatter";

describe("formatCellValue", () => {
  // ── date type ─────────────────────────────────────────────────────────────

  it("formats an epoch-millisecond number as YYYY-MM-DD for date columns", () => {
    // 2024-01-18T00:00:00.000Z in epoch ms
    expect(formatCellValue(1705536000000, "date")).toBe("2024-01-18");
  });

  it("formats a Date object as YYYY-MM-DD for date columns", () => {
    const date = new Date("2024-06-15T00:00:00.000Z");
    expect(formatCellValue(date, "date")).toBe("2024-06-15");
  });

  it("formats an ISO date string as YYYY-MM-DD for date columns", () => {
    expect(formatCellValue("2024-03-25", "date")).toBe("2024-03-25");
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

  it("trims floating-point noise in number columns", () => {
    expect(formatCellValue(409.95000000000005, "number")).toBe("409.95");
  });

  it("preserves meaningful numeric precision in number columns", () => {
    expect(formatCellValue(1234567890.12, "number")).toBe("1234567890.12");
    expect(formatCellValue(0.123456789012345, "number")).toBe(
      "0.123456789012345",
    );
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
