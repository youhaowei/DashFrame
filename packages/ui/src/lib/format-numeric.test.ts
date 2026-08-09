import { describe, expect, it } from "vitest";
import { formatNumeric } from "./format-numeric";

describe("formatNumeric", () => {
  it.each([
    [409.95, "409.95"],
    [409.95000000000005, "409.95000000000005"],
    [1234567890.12, "1234567890.12"],
    [0.123456789012345, "0.123456789012345"],
    [0.1234567890123456, "0.1234567890123456"],
    [1.2345678901234567, "1.2345678901234567"],
    [1 + Number.EPSILON, "1.0000000000000002"],
    [-0.30000000000000004, "-0.30000000000000004"],
    [12.333333333333334, "12.333333333333334"],
    [12345678901, "12345678901"],
  ])("preserves the exact Number value %s", (value, expected) => {
    const formatted = formatNumeric(value);

    expect(formatted).toBe(expected);
    expect(Object.is(Number(formatted), value)).toBe(true);
  });

  it("passes through non-finite values as strings", () => {
    expect(formatNumeric(Infinity)).toBe("Infinity");
    expect(formatNumeric(-Infinity)).toBe("-Infinity");
    expect(formatNumeric(NaN)).toBe("NaN");
  });
});
