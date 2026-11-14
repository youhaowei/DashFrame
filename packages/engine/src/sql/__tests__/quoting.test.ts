import { describe, expect, it } from "bun:test";

import { quoteIdentifier, quoteLiteral } from "../quoting";

describe("quoteIdentifier", () => {
  it("escapes embedded double-quotes by doubling them", () => {
    expect(quoteIdentifier('weird"name')).toBe('"weird""name"');
    expect(quoteIdentifier('"already quoted"')).toBe('"""already quoted"""');
  });
});

describe("quoteLiteral", () => {
  it("escapes embedded single-quotes by doubling them", () => {
    expect(quoteLiteral("O'Brien")).toBe("'O''Brien'");
    expect(quoteLiteral("it's fine")).toBe("'it''s fine'");
    expect(quoteLiteral("a'b'c")).toBe("'a''b''c'");
  });
});
