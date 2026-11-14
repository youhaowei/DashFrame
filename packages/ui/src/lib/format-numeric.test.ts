import { describe, expect, it } from "vite-plus/test";
import { formatNumeric } from "./format-numeric";

describe("formatNumeric", () => {
  it("strips IEEE-754 noise from SUM result (canonical bug case)", () => {
    // DuckDB SUM(amount) for 409.95 produces this raw float:
    expect(formatNumeric(409.95000000000005)).toBe("409.95");
  });

  it("leaves large integers exact (no toPrecision truncation)", () => {
    // COUNT(*) or financial IDs with > 10 significant digits must never be rounded
    expect(formatNumeric(12345678901)).toBe("12345678901");
    expect(formatNumeric(100000000011)).toBe("100000000011");
  });

  it("handles AVG noise (fractional with many decimals)", () => {
    // A representative AVG result with noise past the 10th sig-fig
    expect(formatNumeric(12.333333333333334)).toBe("12.33333333");
  });

  it("passes through non-finite values as strings", () => {
    expect(formatNumeric(Infinity)).toBe("Infinity");
    expect(formatNumeric(-Infinity)).toBe("-Infinity");
    expect(formatNumeric(NaN)).toBe("NaN");
  });
});
