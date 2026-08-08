/**
 * `encoding` is stored as opaque jsonb, so a row written before the write gate
 * existed can hold any shape at a channel. Both readers below have a deliberate
 * legacy fallback that treats an unparseable value as a raw column name — for a
 * non-string that would forward the value itself into SQL construction, so both
 * must screen the type instead.
 */

import { describe, expect, it } from "bun:test";

import { resolveForAnalysis, resolveToSql } from "./encoding-resolution";

const CONTEXT = { fields: [], metrics: [] } as never;

// The exact payload from GH #289, plus the other non-string shapes jsonb allows.
const MALFORMED = [{ field: "region" }, 42, true, ["field:a"], null] as never[];

describe("encoding resolution — malformed stored values", () => {
  it("resolveToSql returns undefined rather than emitting the value as SQL", () => {
    for (const bad of MALFORMED) {
      expect(resolveToSql(bad, CONTEXT)).toBeUndefined();
    }
  });

  it("resolveForAnalysis reports invalid rather than naming a column", () => {
    for (const bad of MALFORMED) {
      const resolved = resolveForAnalysis(bad, CONTEXT);
      expect(resolved.valid).toBe(false);
      expect(resolved.columnName).toBeUndefined();
    }
  });

  it("still passes a legacy raw column name through", () => {
    // The fallback exists for saved visualizations that stored bare column
    // names; screening the type must not close it.
    expect(resolveToSql("sum(revenue)", CONTEXT)).toBe("sum(revenue)");
    expect(resolveForAnalysis("sum(revenue)", CONTEXT)).toEqual({
      columnName: "sum(revenue)",
      isMetric: false,
      valid: true,
    });
  });
});
