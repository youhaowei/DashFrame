import { describe, expect, it } from "vitest";
import { parseTableOrigin } from "../convex/tableCodec";

const definition = {
  dimensions: ["date"],
  metrics: ["sessions"],
  dateRange: { kind: "relative", months: 1 },
  grain: "day",
  filters: [
    { kind: "dimension", field: "country", operator: "exact", values: ["US"] },
  ],
};

describe("parseTableOrigin", () => {
  it("accepts a resource and preserves connector-specific definition keys", () => {
    expect(parseTableOrigin({ kind: "resource" }, "origin")).toEqual({
      kind: "resource",
    });
    const origin = { kind: "definition", version: 1, definition };
    expect(parseTableOrigin(origin, "origin")).toEqual(origin);
  });

  it.each([
    { kind: "resource", extra: true },
    { kind: "bogus" },
    { kind: "definition", version: 2, definition },
    {
      kind: "definition",
      version: 1,
      definition: { ...definition, metrics: [] },
    },
    {
      kind: "definition",
      version: 1,
      definition: { ...definition, filters: [{ kind: "unknown" }] },
    },
  ])("rejects malformed origin %# with a codec message", (value) => {
    expect(() => parseTableOrigin(value, "origin")).toThrow(
      /^origin is invalid: /,
    );
  });
});
