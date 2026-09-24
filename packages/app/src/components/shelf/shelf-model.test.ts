/**
 * What the shelf shows for its items: their live names, a missing artifact,
 * and which items the current page's drop targets can use.
 */
import { describe, expect, it } from "vite-plus/test";

import type { RegisteredDropTarget } from "./drag-context";
import { partitionForPage, resolveShelfItem } from "./shelf-model";
import type { ShelfItem } from "./shelf-store";

const metric: ShelfItem = {
  kind: "metric",
  id: "m1",
  scope: "t1",
  label: "Sum of Sales",
  pinned: false,
};
const chart: ShelfItem = {
  kind: "chart",
  id: "v1",
  scope: "i1",
  label: "Sales by Product",
  pinned: true,
};

describe("resolveShelfItem", () => {
  const tables = [
    {
      id: "t1",
      fields: [{ id: "f1", name: "Category" }],
      metrics: [{ id: "m1", name: "Total sales" }],
    },
  ];

  it("takes the live name of an artifact that still exists", () => {
    expect(resolveShelfItem(metric, { tables })).toEqual({
      status: "live",
      label: "Total sales",
    });
  });

  it("marks an artifact that no longer exists, keeping its stored name", () => {
    expect(resolveShelfItem(chart, { visualizations: [] })).toEqual({
      status: "missing",
      label: "Sales by Product",
    });
    expect(
      resolveShelfItem({ ...metric, scope: "gone-table" }, { tables }),
    ).toMatchObject({ status: "missing" });
  });

  it("waits for a list that has not loaded instead of calling it missing", () => {
    expect(resolveShelfItem(chart, {})).toEqual({
      status: "loading",
      label: "Sales by Product",
    });
  });

  it("names an unnamed chart", () => {
    expect(
      resolveShelfItem(chart, { visualizations: [{ id: "v1", name: "" }] }),
    ).toEqual({ status: "live", label: "Untitled chart" });
  });
});

describe("partitionForPage", () => {
  const shelfTarget: RegisteredDropTarget = {
    id: "shelf-nav",
    role: "shelf",
    accepts: () => ({ ok: true, label: "Keep on the shelf" }),
  };
  // A no-op example of the seam later targets use: it takes metrics only.
  const metricWell: RegisteredDropTarget = {
    id: "y-well",
    role: "page",
    accepts: (item) =>
      item.kind === "metric"
        ? { ok: true, label: "Set Y" }
        : { ok: false, reason: "A chart can't go on an axis" },
  };

  it("shows every item on a page with no page targets", () => {
    expect(partitionForPage([metric, chart], [shelfTarget])).toEqual({
      usable: [metric, chart],
      elsewhere: [],
    });
  });

  it("folds items no page target takes into the elsewhere group", () => {
    expect(
      partitionForPage([metric, chart], [shelfTarget, metricWell]),
    ).toEqual({ usable: [metric], elsewhere: [chart] });
  });
});
