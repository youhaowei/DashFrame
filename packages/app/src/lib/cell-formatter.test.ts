import { describe, expect, it } from "vite-plus/test";
import { formatCellValue } from "./cell-formatter";

describe("formatCellValue", () => {
  // ── date type ─────────────────────────────────────────────────────────────

  it("formats an epoch-millisecond number for date columns", () => {
    // 2024-01-18T00:00:00.000Z in epoch ms
    expect(formatCellValue(1705536000000, "date")).toBe("Jan 18, 2024");
  });

  it("returns — for null in a date column", () => {
    expect(formatCellValue(null, "date")).toBe("—");
  });

  it("returns — for an unparseable value in a date column", () => {
    expect(formatCellValue("not-a-date", "date")).toBe("—");
  });

  // ── non-date types (the critical guard: keys off type, not value) ──────────

  it("does NOT format a large number as a date when the column type is number", () => {
    // 1705536000000 looks like a date epoch, but the column type is number
    const result = formatCellValue(1705536000000, "number");
    expect(result).toBe("1705536000000");
    // Ensure it was NOT treated as a date
    expect(result).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("serialises objects as JSON for unknown columns", () => {
    expect(formatCellValue({ a: 1 }, "unknown")).toBe('{"a":1}');
  });
});
