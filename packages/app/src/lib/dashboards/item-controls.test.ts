/**
 * Disclosure rules for a report item's runtime controls.
 *
 * Named contracts:
 * - Absent item entry = hidden; the control is not in the result at all.
 * - Report-bound filter = not drawn on the tile.
 * - changeable = Insight ceiling AND item tightening; the item never loosens.
 * - Order: filters in declaration order, then sort, then limit.
 * - Only a filter pins; a sort or limit is never on the tile face.
 * - An id-carrying override varies its own predicate, not its whole field.
 * - valueText reads the effective override before the saved default.
 */

import type { DashboardControl, Insight, UUID } from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";
import { resolveItemControls, withItemControl } from "./item-controls";

const insight: Pick<Insight, "filters" | "sorts" | "runtimeControls"> = {
  filters: [
    { id: "f-region", field: "region", operator: "eq", value: "EMEA" },
    { id: "f-channel", field: "channel", operator: "ne", value: "Partner" },
  ],
  sorts: [{ field: "revenue", direction: "desc" }],
  runtimeControls: {
    filters: [
      { key: "region", filterId: "f-region", label: "Region" },
      {
        key: "direct",
        filterId: "f-channel",
        label: "Direct only",
        changeable: false,
      },
    ],
    sort: { label: "Ranked by", allowedFieldIds: ["revenue"], maxKeys: 1 },
    limit: { min: 1, max: 100 },
  },
};

const itemId = "item-1" as UUID;

describe("resolveItemControls", () => {
  it("returns nothing when the item discloses nothing", () => {
    expect(
      resolveItemControls({
        insight,
        item: { id: itemId },
        dashboardControls: [],
        effectiveOverrides: undefined,
      }),
    ).toEqual([]);
  });

  it("orders filters, then sort, then limit, and never pins a sort or limit", () => {
    const controls = resolveItemControls({
      insight,
      item: {
        id: itemId,
        controls: {
          region: { visibility: "pinned" },
          sort: { visibility: "visible" },
          limit: { visibility: "pinned" },
        },
      },
      dashboardControls: [],
      effectiveOverrides: { limit: 10 },
      sortFieldLabel: (field) => (field === "revenue" ? "Revenue" : field),
    });
    expect(controls.map((c) => [c.key, c.kind, c.label, c.valueText])).toEqual([
      ["region", "filter", "Region", "EMEA"],
      ["sort", "sort", "Ranked by", "Revenue, high to low"],
      ["limit", "limit", "", "Top 10"],
    ]);
    expect(controls.map((c) => c.pinned)).toEqual([true, false, false]);
  });

  it("never loosens the Insight's ceiling and lets the item tighten it", () => {
    const controls = resolveItemControls({
      insight,
      item: {
        id: itemId,
        controls: {
          region: { visibility: "pinned", changeable: false },
          direct: { visibility: "pinned" },
        },
      },
      dashboardControls: [],
      effectiveOverrides: undefined,
    });
    expect(controls.map((c) => [c.key, c.changeable])).toEqual([
      ["region", false],
      ["direct", false],
    ]);
  });

  it("drops a filter whose field a report control owns for this item", () => {
    const control: DashboardControl = {
      id: "c1" as UUID,
      field: "region",
      boundInstances: [itemId],
    };
    const controls = resolveItemControls({
      insight,
      item: { id: itemId, controls: { region: { visibility: "pinned" } } },
      dashboardControls: [control],
      effectiveOverrides: undefined,
    });
    expect(controls).toEqual([]);
  });

  it("reads the effective override before the saved default", () => {
    const [region] = resolveItemControls({
      insight,
      item: { id: itemId, controls: { region: { visibility: "visible" } } },
      dashboardControls: [],
      effectiveOverrides: {
        filters: [
          { id: "f-region", field: "region", operator: "eq", value: "APAC" },
        ],
      },
    });
    expect(region?.valueText).toBe("APAC");
    const [cleared] = resolveItemControls({
      insight,
      item: { id: itemId, controls: { region: { visibility: "visible" } } },
      dashboardControls: [],
      effectiveOverrides: {
        filters: [
          {
            id: "f-region",
            field: "region",
            operator: "eq",
            value: null,
            cleared: true,
          },
        ],
      },
    });
    expect(cleared?.valueText).toBe("All");
  });

  it("shows the literal behind an agent-tagged operand", () => {
    const [region] = resolveItemControls({
      insight: {
        ...insight,
        filters: [
          {
            id: "f-region",
            field: "region",
            operator: "eq",
            value: { kind: "value", v: "EMEA" },
          },
        ],
      },
      item: { id: itemId, controls: { region: { visibility: "pinned" } } },
      dashboardControls: [],
      effectiveOverrides: undefined,
    });
    expect(region?.valueText).toBe("EMEA");
  });

  it("does not draw an undeclared control even when the item names it", () => {
    const controls = resolveItemControls({
      insight: { ...insight, runtimeControls: undefined },
      item: { id: itemId, controls: { region: { visibility: "pinned" } } },
      dashboardControls: [],
      effectiveOverrides: undefined,
    });
    expect(controls).toEqual([]);
  });
});

describe("withItemControl", () => {
  it("stores only what differs from hidden-and-as-declared", () => {
    expect(
      withItemControl(undefined, "region", { visibility: "pinned" }),
    ).toEqual({
      region: { visibility: "pinned" },
    });
    expect(
      withItemControl({ region: { visibility: "pinned" } }, "region", {
        visibility: "hidden",
      }),
    ).toEqual({});
    expect(withItemControl(undefined, "sort", { changeable: false })).toEqual({
      sort: { visibility: "hidden", changeable: false },
    });
  });

  it("keeps the other keys and the tightening across a visibility change", () => {
    expect(
      withItemControl(
        {
          region: { visibility: "visible", changeable: false },
          limit: { visibility: "pinned" },
        },
        "region",
        { visibility: "pinned" },
      ),
    ).toEqual({
      region: { visibility: "pinned", changeable: false },
      limit: { visibility: "pinned" },
    });
    expect(
      withItemControl(
        { region: { visibility: "pinned", changeable: false } },
        "region",
        {
          changeable: undefined,
        },
      ),
    ).toEqual({ region: { visibility: "pinned" } });
  });
});

describe("two declared filters on one field", () => {
  const range: Pick<Insight, "filters" | "sorts" | "runtimeControls"> = {
    filters: [
      { id: "f-min", field: "quantity", operator: "gte", value: 2 },
      { id: "f-max", field: "quantity", operator: "lte", value: 10 },
    ],
    runtimeControls: {
      filters: [
        { key: "min", filterId: "f-min", label: "Min quantity" },
        { key: "max", filterId: "f-max", label: "Max quantity" },
      ],
    },
  };

  it("reads each control's own override, never its sibling's", () => {
    const controls = resolveItemControls({
      insight: range,
      item: {
        id: itemId,
        controls: {
          min: { visibility: "pinned" },
          max: { visibility: "pinned" },
        },
      },
      dashboardControls: [],
      effectiveOverrides: {
        filters: [
          { id: "f-max", field: "quantity", operator: "lte", value: 5 },
        ],
      },
    });
    expect(controls.map((c) => [c.key, c.override?.value])).toEqual([
      ["min", undefined],
      ["max", 5],
    ]);
  });
});
