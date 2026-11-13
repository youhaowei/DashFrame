import { describe, expect, it } from "bun:test";

import { quoteIdentifier, quoteLiteral } from "../quoting";

describe("quoteIdentifier", () => {
  it("wraps a normal identifier in double-quotes", () => {
    expect(quoteIdentifier("name")).toBe('"name"');
    expect(quoteIdentifier("user_id")).toBe('"user_id"');
  });

  it("escapes embedded double-quotes by doubling them", () => {
    expect(quoteIdentifier('weird"name')).toBe('"weird""name"');
    expect(quoteIdentifier('"already quoted"')).toBe('"""already quoted"""');
  });

  it("does not break SQL when the result is interpolated (no injection)", () => {
    // A crafted column name that would break naive interpolation
    const malicious = 'x" FROM secrets --';
    const quoted = quoteIdentifier(malicious);
    // The embedded double-quote is escaped; the result starts and ends with "
    expect(quoted).toBe('"x"" FROM secrets --"');
    expect(quoted.startsWith('"')).toBe(true);
    expect(quoted.endsWith('"')).toBe(true);
  });
});

describe("quoteLiteral", () => {
  it("wraps a normal string in single-quotes", () => {
    expect(quoteLiteral("hello")).toBe("'hello'");
    expect(quoteLiteral("2024-01-01")).toBe("'2024-01-01'");
  });

  it("escapes embedded single-quotes by doubling them", () => {
    expect(quoteLiteral("O'Brien")).toBe("'O''Brien'");
    expect(quoteLiteral("it's fine")).toBe("'it''s fine'");
  });

  it("handles multiple embedded single-quotes", () => {
    expect(quoteLiteral("a'b'c")).toBe("'a''b''c'");
  });
});
