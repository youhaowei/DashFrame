import { describe, expect, it } from "vite-plus/test";

import { isColumnValidForChannel, validateEncoding } from "./encoding-enforcer";

/**
 * The enforcer runs during RENDER, in the visualization page's `encodingErrors`
 * memo and in the axis picker's `validationError` memo — both of which sit
 * ABOVE the per-chart error boundary. A throw here is not contained by that
 * boundary: it unwinds to the router and replaces the whole page, which is the
 * GH #289 symptom the boundary was added to prevent.
 *
 * `encoding` is stored as opaque jsonb, so a row written before the write gate
 * existed can still hold any shape. The enforcer must therefore TOLERATE a
 * malformed value rather than trust its declared `string` type.
 */
const ANALYSIS = [
  { columnName: "region", dataType: "VARCHAR", semanticType: "categorical" },
  { columnName: "amount", dataType: "DOUBLE", semanticType: "numeric" },
] as never;

describe("encoding enforcer — malformed stored values", () => {
  // The exact payload from GH #289.
  const objectValue = { field: "region" } as never;

  it("does not throw on an object-valued channel", () => {
    expect(() =>
      validateEncoding({ x: objectValue }, "barY", ANALYSIS),
    ).not.toThrow();
    expect(() =>
      validateEncoding({ x: "field:x", y: objectValue }, "barY", ANALYSIS),
    ).not.toThrow();
  });

  it("does not throw on any other non-string channel value", () => {
    for (const bad of [42, true, ["field:a"], null] as never[]) {
      expect(() =>
        validateEncoding({ x: bad }, "barY", ANALYSIS),
      ).not.toThrow();
    }
  });

  it("does not throw when the axis picker validates a malformed value", () => {
    // AxisSelectField passes its raw `value` prop straight through, so the
    // config panel the user would repair the chart with must survive it too.
    expect(() =>
      isColumnValidForChannel(objectValue, "x", "barY", ANALYSIS),
    ).not.toThrow();
  });

  it("still reports a real mismatch on a well-formed value", () => {
    // Tolerating garbage must not make the enforcer tolerate everything.
    const errors = validateEncoding({ y: "region" }, "barY", ANALYSIS);
    expect(errors.y).toBeTruthy();
  });
});
