import { describe, expect, it } from "vitest";
import { formatNumeric } from "./format-numeric";

describe("formatNumeric", () => {
  it("strips IEEE-754 noise from SUM result (canonical bug case)", () => {
    // DuckDB SUM(amount) for 409.95 produces this raw float:
    expect(formatNumeric(409.95000000000005)).toBe("409.95");
  });

  it("leaves a clean decimal unchanged", () => {
    expect(formatNumeric(409.95)).toBe("409.95");
  });

  it("leaves an integer unchanged (no decimal point added)", () => {
    expect(formatNumeric(1000)).toBe("1000");
    expect(formatNumeric(0)).toBe("0");
    expect(formatNumeric(-42)).toBe("-42");
  });

  it("leaves large integers exact (no toPrecision truncation)", () => {
    // COUNT(*) or financial IDs with > 10 significant digits must never be rounded
    expect(formatNumeric(12345678901)).toBe("12345678901");
    expect(formatNumeric(100000000011)).toBe("100000000011");
  });

  it("preserves genuine long-decimal precision within 10 sig-figs", () => {
    // 1234.5678 has 8 sig-figs — well within 10, should round-trip exactly
    expect(formatNumeric(1234.5678)).toBe("1234.5678");
  });

  it("does not over-truncate a legitimately precise value", () => {
    // 10 sig-figs: 12345678.90 → stays as-is (trailing zero stripped by parseFloat)
    expect(formatNumeric(12345678.9)).toBe("12345678.9");
  });

  it("handles negative floats with noise", () => {
    // -0.1 - 0.2 = -0.30000000000000004 in IEEE-754
    expect(formatNumeric(-0.30000000000000004)).toBe("-0.3");
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
