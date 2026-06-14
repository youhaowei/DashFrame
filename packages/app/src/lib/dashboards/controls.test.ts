/**
 * Tests for dashboard controls — broadcast logic, eligibility, and transient state.
 *
 * Named contracts:
 * - A control bound to N cells broadcasts its value → those cells' effective params reflect it.
 * - Binding is opt-in: an eligible-but-unbound cell is NOT affected.
 * - Source-schema eligibility: a control can't bind to a cell whose insight source lacks the field.
 * - defaultValue applies on load (computeItemOverrides with no transient).
 * - Bound control value (binding = delegation): wins over the cell's own pinned value.
 * - Viewer-transient: turning a control does NOT mutate the saved dashboard control value.
 */

import type {
  DashboardControl,
  DashboardItem,
  DataTable,
  Field,
  UUID,
} from "@dashframe/types";
import { describe, expect, it } from "vitest";
import {
  computeItemOverrides,
  isControlEligible,
  resolveControlValue,
  setTransientValue,
} from "./controls";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TABLE_ID = "00000000-0000-0000-0000-000000000001" as UUID;

function makeField(name: string, columnName?: string): Field {
  return {
    id: `field-${name}` as UUID,
    name,
    tableId: TABLE_ID,
    columnName: columnName ?? name,
    type: "string",
  };
}

function makeTable(fields: Field[]): DataTable {
  return {
    id: TABLE_ID,
    name: "sales",
    dataSourceId: "ds-1" as UUID,
    table: "sales",
    fields,
    metrics: [],
    createdAt: Date.now(),
  };
}

function makeItem(
  id: UUID,
  overrides?: DashboardItem["overrides"],
): DashboardItem {
  return {
    id,
    type: "visualization",
    visualizationId: `viz-${id}` as UUID,
    x: 0,
    y: 0,
    width: 4,
    height: 4,
    overrides,
  };
}

function makeControl(
  field: string,
  boundInstances: UUID[],
  defaultValue?: unknown,
  id: UUID = `ctrl-${field}` as UUID,
): DashboardControl {
  return {
    id,
    field,
    boundInstances,
    defaultValue,
  };
}

// ---------------------------------------------------------------------------
// isControlEligible
// ---------------------------------------------------------------------------

describe("isControlEligible — source-schema eligibility", () => {
  it("returns true when the field is present in the table's fields", () => {
    const table = makeTable([makeField("region")]);
    expect(isControlEligible("region", table)).toBe(true);
  });

  it("returns true when columnName differs from name but matches the lookup", () => {
    const field: Field = {
      id: "f1" as UUID,
      name: "Region Label",
      tableId: TABLE_ID,
      columnName: "region",
      type: "string",
    };
    const table = makeTable([field]);
    expect(isControlEligible("region", table)).toBe(true);
  });

  it("returns false when the field is NOT in the table's fields", () => {
    const table = makeTable([makeField("month")]);
    expect(isControlEligible("region", table)).toBe(false);
  });

  it("returns false when the source table is undefined (insight not loaded)", () => {
    expect(isControlEligible("region", undefined)).toBe(false);
  });

  it("returns false when the table has no fields", () => {
    const table = makeTable([]);
    expect(isControlEligible("region", table)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeItemOverrides — broadcast
// ---------------------------------------------------------------------------

describe("computeItemOverrides — broadcast to bound cells", () => {
  const ITEM_A = "item-a" as UUID;
  const ITEM_B = "item-b" as UUID;
  const ITEM_C = "item-c" as UUID;

  it("control bound to N cells broadcasts its value to those cells", () => {
    const control = makeControl("region", [ITEM_A, ITEM_B], "APAC");
    const itemA = makeItem(ITEM_A);
    const itemB = makeItem(ITEM_B);

    const ovA = computeItemOverrides(itemA, [control]);
    const ovB = computeItemOverrides(itemB, [control]);

    expect(ovA?.filters).toContainEqual(
      expect.objectContaining({
        field: "region",
        operator: "eq",
        value: "APAC",
      }),
    );
    expect(ovB?.filters).toContainEqual(
      expect.objectContaining({
        field: "region",
        operator: "eq",
        value: "APAC",
      }),
    );
  });

  it("binding is opt-in: eligible-but-unbound cell is NOT affected", () => {
    const control = makeControl("region", [ITEM_A], "APAC");
    const itemC = makeItem(ITEM_C); // not in boundInstances

    const ov = computeItemOverrides(itemC, [control]);

    // Returns the item's own overrides (undefined), no control injection.
    expect(ov).toBeUndefined();
  });

  it("control with no defaultValue injects no concrete eq filter", () => {
    const control = makeControl("region", [ITEM_A], undefined);
    const item = makeItem(ITEM_A);

    const ov = computeItemOverrides(item, [control]);

    // No value → no concrete (eq) filter injected for the field.
    const concreteRegion = (ov?.filters ?? []).filter(
      (f) => f.field === "region" && !f.cleared,
    );
    expect(concreteRegion).toHaveLength(0);
  });

  it("blank bound control on a no-override cell emits only a widening (cleared) override", () => {
    // A bound-but-blank control must WIDEN its field (clear the insight's
    // default), so it emits exactly one `cleared` override and nothing else.
    // It must NOT produce a bag carrying a concrete filter, sorts, or limit.
    const control = makeControl("region", [ITEM_A], undefined);
    const item = makeItem(ITEM_A); // no overrides

    const ov = computeItemOverrides(item, [control]);

    expect(ov?.filters).toEqual([
      expect.objectContaining({ field: "region", cleared: true }),
    ]);
    expect(ov?.sorts).toBeUndefined();
    expect(ov?.limit).toBeUndefined();
  });

  it("returns the cell's own overrides untouched when no bound control is active and nothing is cleared", () => {
    // Sanity: with no bound controls there is no cleared override and no
    // injection, so the original (undefined) overrides pass through — the
    // `effectiveOverrides ?? item.overrides` guard sees no empty bag.
    const control = makeControl("region", [], undefined); // bound to nothing
    const item = makeItem(ITEM_A); // not in boundInstances, no overrides

    const ov = computeItemOverrides(item, [control]);

    expect(ov).toBeUndefined();
  });

  it("blank bound control WIDENS a field the cell had pinned (emits cleared override)", () => {
    // Codex thread: a blank control must clear the field, not silently inherit
    // the cell's own pinned predicate.  The cell pins region=US; the control is
    // bound to region but blank → the effective override must DROP the pin and
    // emit a `cleared` entry so resolveEffectiveParams widens region.
    const control = makeControl("region", [ITEM_A], undefined);
    const item = makeItem(ITEM_A, {
      filters: [{ field: "region", operator: "eq", value: "US" }],
    });

    const ov = computeItemOverrides(item, [control]);

    // The pinned region=US is gone; a cleared override for region is present.
    const regionFilters = (ov?.filters ?? []).filter(
      (f) => f.field === "region",
    );
    expect(regionFilters).toHaveLength(1);
    expect(regionFilters[0]).toEqual(
      expect.objectContaining({ field: "region", cleared: true }),
    );
    // No concrete value remains for region.
    expect(regionFilters.some((f) => !f.cleared)).toBe(false);
  });

  it("blank bound control preserves the cell's saved sorts/limit", () => {
    const control = makeControl("region", [ITEM_A], undefined);
    const item = makeItem(ITEM_A, {
      sorts: [{ field: "sales", direction: "desc" }],
      limit: 10,
    });

    const ov = computeItemOverrides(item, [control]);

    expect(ov?.sorts).toEqual([{ field: "sales", direction: "desc" }]);
    expect(ov?.limit).toBe(10);
  });

  it("multiple controls on the same item each inject their own field filter", () => {
    const regionCtrl = makeControl("region", [ITEM_A], "APAC");
    const monthCtrl = makeControl("month", [ITEM_A], "2024-01");
    const item = makeItem(ITEM_A);

    const ov = computeItemOverrides(item, [regionCtrl, monthCtrl]);

    expect(ov?.filters).toContainEqual(
      expect.objectContaining({ field: "region", value: "APAC" }),
    );
    expect(ov?.filters).toContainEqual(
      expect.objectContaining({ field: "month", value: "2024-01" }),
    );
  });
});

// ---------------------------------------------------------------------------
// defaultValue applies on load
// ---------------------------------------------------------------------------

describe("defaultValue applies on load (no transient map)", () => {
  const ITEM_A = "item-a" as UUID;

  it("defaultValue is used when no transient override exists", () => {
    const control = makeControl("region", [ITEM_A], "EU");
    const item = makeItem(ITEM_A);

    const ov = computeItemOverrides(item, [control], new Map());

    expect(ov?.filters).toContainEqual(
      expect.objectContaining({ field: "region", value: "EU" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Bound field wins over cell's pinned value (binding = delegation)
// ---------------------------------------------------------------------------

describe("override coalesce §6: bound control value wins over cell pinned value", () => {
  const ITEM_A = "item-a" as UUID;

  it("control value replaces the cell's own pinned filter for the same field", () => {
    const control = makeControl("region", [ITEM_A], "APAC");
    // Cell has its own pinned filter for region = "US"
    const item = makeItem(ITEM_A, {
      filters: [{ field: "region", operator: "eq", value: "US" }],
    });

    const ov = computeItemOverrides(item, [control]);

    // Control's value "APAC" wins; the pinned "US" is shadowed.
    const regionFilters = (ov?.filters ?? []).filter(
      (f) => f.field === "region",
    );
    expect(regionFilters).toHaveLength(1);
    expect(regionFilters[0]!.value).toBe("APAC");
  });

  it("non-overlapping pinned filters for other fields are preserved", () => {
    const control = makeControl("region", [ITEM_A], "APAC");
    const item = makeItem(ITEM_A, {
      filters: [
        { field: "region", operator: "eq", value: "US" },
        { field: "channel", operator: "eq", value: "online" },
      ],
    });

    const ov = computeItemOverrides(item, [control]);

    // channel filter preserved; region overridden
    expect(ov?.filters).toContainEqual(
      expect.objectContaining({ field: "channel", value: "online" }),
    );
    expect(ov?.filters).toContainEqual(
      expect.objectContaining({ field: "region", value: "APAC" }),
    );
    expect(
      (ov?.filters ?? []).filter((f) => f.field === "region"),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Viewer-transient: turning a control does NOT mutate saved control
// ---------------------------------------------------------------------------

describe("viewer-transient: control turn does not mutate saved dashboard", () => {
  const ITEM_A = "item-a" as UUID;

  it("setTransientValue does not mutate the input map", () => {
    const original = new Map<string, unknown>([["ctrl-1", "EU"]]);
    const next = setTransientValue(original, "ctrl-2", "APAC");

    expect(original.has("ctrl-2")).toBe(false);
    expect(next.get("ctrl-2")).toBe("APAC");
    expect(next.get("ctrl-1")).toBe("EU");
  });

  it("transient value overrides saved defaultValue in computeItemOverrides", () => {
    const control = makeControl(
      "region",
      [ITEM_A],
      "EU",
      "ctrl-region" as UUID,
    );
    const item = makeItem(ITEM_A);
    const transient = new Map<string, unknown>([["ctrl-region", "APAC"]]);

    const ov = computeItemOverrides(item, [control], transient);

    // Viewer's transient "APAC" wins over saved "EU"
    const regionFilters = (ov?.filters ?? []).filter(
      (f) => f.field === "region",
    );
    expect(regionFilters).toHaveLength(1);
    expect(regionFilters[0]!.value).toBe("APAC");
  });

  it("saved control defaultValue is NOT mutated by viewer transient turn", () => {
    const control = makeControl(
      "region",
      [ITEM_A],
      "EU",
      "ctrl-region" as UUID,
    );
    const originalDefault = control.defaultValue;
    const item = makeItem(ITEM_A);

    // Viewer turns the control
    const transient = setTransientValue(new Map(), "ctrl-region", "APAC");
    computeItemOverrides(item, [control], transient);

    // The saved control object is unchanged
    expect(control.defaultValue).toBe(originalDefault);
    expect(control.defaultValue).toBe("EU");
  });

  it("resolveControlValue returns transient value when present", () => {
    const control = makeControl("region", [ITEM_A], "EU", "ctrl-1" as UUID);
    const transient = new Map<string, unknown>([["ctrl-1", "APAC"]]);

    expect(resolveControlValue(control, transient)).toBe("APAC");
  });

  it("resolveControlValue returns defaultValue when no transient", () => {
    const control = makeControl("region", [ITEM_A], "EU", "ctrl-1" as UUID);
    const empty = new Map<string, unknown>();

    expect(resolveControlValue(control, empty)).toBe("EU");
  });
});
