/**
 * How a drag's end is decided: a target that takes the item gets it, one that
 * refuses keeps nothing, and a drag over nothing drops nothing.
 */
import { describe, expect, it } from "vite-plus/test";

import { resolveDrop, type DropVerdict } from "./drag-context";
import type { ShelfItemRef } from "./shelf-store";

const metric: ShelfItemRef = {
  kind: "metric",
  id: "m1",
  scope: "t1",
  label: "Sum of Sales",
};

function target(accepts: (item: ShelfItemRef, from: string) => DropVerdict) {
  return { dashframeTarget: { accepts, onDrop: () => {} } };
}
const carried = (from: "shelf" | "source") => ({
  dashframeDrag: { item: metric, from },
});
// The shelf's own rule: anything from the page, nothing from itself.
const shelf = target((_item, from) =>
  from === "shelf"
    ? { ok: false, reason: "Already on the shelf" }
    : { ok: true, label: "Put on shelf" },
);

describe("resolveDrop", () => {
  it("drops onto a target that takes the item", () => {
    expect(resolveDrop(carried("source"), shelf)).toEqual({
      kind: "drop",
      drag: { item: metric, from: "source" },
      verdict: { ok: true, label: "Put on shelf" },
    });
  });

  it("refuses when the target says no, with its reason", () => {
    const chartsOnly = target(() => ({ ok: false, reason: "Charts only" }));
    expect(resolveDrop(carried("source"), chartsOnly)).toMatchObject({
      kind: "refused",
      reason: "Charts only",
    });
  });

  it("refuses a shelf chip dropped back onto the shelf", () => {
    expect(resolveDrop(carried("shelf"), shelf)).toMatchObject({
      kind: "refused",
      reason: "Already on the shelf",
    });
  });

  it("drops nothing over no target, or for a drag that carries no item", () => {
    expect(resolveDrop(carried("source"), undefined)).toEqual({ kind: "none" });
    expect(resolveDrop({ sortable: {} }, shelf)).toEqual({ kind: "none" });
  });
});
