/**
 * Tests for override-field-row-utils.ts
 *
 * Contracts tested:
 *
 * STATE RESOLUTION — given (item.overrides, controls, fieldName), derive the 4-state machine:
 * 1. inherit: no cell override, no bound control.
 * 2. pinned: cell override entry with a value (non-cleared), no bound control.
 * 3. cleared: cell override entry with `cleared: true`, no bound control.
 * 4. bound: a control with `control.field === fieldName` lists `item.id` in boundInstances.
 *
 * TRANSITION PAYLOADS — given a state + action, assert the written overrides bag:
 * 5. pin: adds/replaces the filter for the field; preserves other filters + sorts + limit.
 * 6. clear: adds cleared entry; preserves other filters + sorts + limit.
 * 7. inherit: removes the entry; preserves other filters + sorts + limit. Empty filters → undefined.
 * 8. sortChange: replaces sorts; preserves filters + limit.
 * 9. limitChange: replaces limit; preserves filters + sorts.
 *
 * BADGE — hasOverrides truth table.
 * 10. hasOverrides: true on non-empty filters/sorts/limit, false otherwise.
 */

import type {
  DashboardControl,
  DashboardItemOverrides,
  InsightFilter,
  InsightFilterOverride,
  InsightSort,
} from "@dashframe/types";
import { describe, expect, it } from "vitest";
import {
  computeNewOverridesOnClear,
  computeNewOverridesOnInherit,
  computeNewOverridesOnLimitChange,
  computeNewOverridesOnPin,
  computeNewOverridesOnSortChange,
  deriveFieldState,
  hasOverrides,
} from "./override-field-row-utils";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function filter(
  field: string,
  extra?: Partial<InsightFilterOverride>,
): InsightFilterOverride {
  return { field, operator: "eq", value: "v1", ...extra };
}

function control(
  id: string,
  fieldName: string,
  boundInstances: string[],
): DashboardControl {
  return { id, field: fieldName, boundInstances };
}

const ITEM_ID = "item-1";
const FIELD = "created_at";
const OTHER_FIELD = "status";

// ---------------------------------------------------------------------------
// 1–4: State resolution
// ---------------------------------------------------------------------------

describe("deriveFieldState — state resolution", () => {
  it("1. inherit: no override, no bound control", () => {
    const state = deriveFieldState(FIELD, ITEM_ID, undefined, []);
    expect(state).toEqual({ type: "inherit", insightFilter: undefined });
  });

  it("1b. inherit with insightFilter passed through", () => {
    const insightFilter: InsightFilter = {
      field: FIELD,
      operator: "gt",
      value: "2024-01-01",
    };
    const state = deriveFieldState(
      FIELD,
      ITEM_ID,
      undefined,
      [],
      insightFilter,
    );
    expect(state).toEqual({ type: "inherit", insightFilter });
  });

  it("1c. inherit: overrides present but for a different field", () => {
    const overrides: DashboardItemOverrides = {
      filters: [filter(OTHER_FIELD)],
    };
    const state = deriveFieldState(FIELD, ITEM_ID, overrides, []);
    expect(state).toEqual({ type: "inherit", insightFilter: undefined });
  });

  it("2. pinned: cell override with value (non-cleared)", () => {
    const f = filter(FIELD, { value: "2024" });
    const overrides: DashboardItemOverrides = { filters: [f] };
    const state = deriveFieldState(FIELD, ITEM_ID, overrides, []);
    expect(state).toEqual({ type: "pinned", filter: f });
  });

  it("3. cleared: cell override with cleared: true", () => {
    const clearedFilter = filter(FIELD, { cleared: true, value: null });
    const overrides: DashboardItemOverrides = { filters: [clearedFilter] };
    const state = deriveFieldState(FIELD, ITEM_ID, overrides, []);
    expect(state).toEqual({ type: "cleared" });
  });

  it("4. bound: control targeting this field and item wins over a pinned override", () => {
    const pinnedFilter = filter(FIELD, { value: "2024" });
    const overrides: DashboardItemOverrides = { filters: [pinnedFilter] };
    const c = control("ctrl-1", FIELD, [ITEM_ID]);
    const state = deriveFieldState(FIELD, ITEM_ID, overrides, [c]);
    expect(state.type).toBe("bound");
    if (state.type === "bound") {
      expect(state.control).toBe(c);
      // Dormant filter: the item's own pinned entry (shadowed while bound).
      expect(state.dormantFilter).toEqual(pinnedFilter);
    }
  });

  it("4b. bound: no dormant filter when there was no pinned entry", () => {
    const c = control("ctrl-1", FIELD, [ITEM_ID]);
    const state = deriveFieldState(FIELD, ITEM_ID, undefined, [c]);
    expect(state.type).toBe("bound");
    if (state.type === "bound") {
      expect(state.dormantFilter).toBeUndefined();
    }
  });

  it("4c. bound: control does NOT bind if item.id is not in boundInstances", () => {
    const c = control("ctrl-1", FIELD, ["other-item"]);
    const state = deriveFieldState(FIELD, ITEM_ID, undefined, [c]);
    expect(state.type).toBe("inherit");
  });

  it("4d. bound: control does NOT bind if control.field !== fieldName", () => {
    const c = control("ctrl-1", OTHER_FIELD, [ITEM_ID]);
    const state = deriveFieldState(FIELD, ITEM_ID, undefined, [c]);
    expect(state.type).toBe("inherit");
  });
});

// ---------------------------------------------------------------------------
// 5–7: Filter transition payloads
// ---------------------------------------------------------------------------

describe("computeNewOverridesOnPin — transition payload", () => {
  it("5a. adds a new pinned filter when there are no existing overrides", () => {
    const pinFilter: InsightFilterOverride = {
      field: FIELD,
      operator: "eq",
      value: "2024",
    };
    const result = computeNewOverridesOnPin(FIELD, pinFilter, undefined);
    expect(result.filters).toHaveLength(1);
    expect(result.filters![0]).toEqual(pinFilter);
    expect(result.sorts).toBeUndefined();
    expect(result.limit).toBeUndefined();
  });

  it("5b. replaces an existing pinned entry for the same field", () => {
    const existing = filter(FIELD, { value: "old" });
    const overrides: DashboardItemOverrides = { filters: [existing] };
    const newFilter: InsightFilterOverride = {
      field: FIELD,
      operator: "gte",
      value: "2024",
    };
    const result = computeNewOverridesOnPin(FIELD, newFilter, overrides);
    expect(result.filters).toHaveLength(1);
    expect(result.filters![0]).toEqual(newFilter);
  });

  it("5c. replaces a cleared entry for the same field", () => {
    const cleared = filter(FIELD, { cleared: true, value: null });
    const overrides: DashboardItemOverrides = { filters: [cleared] };
    const pinFilter: InsightFilterOverride = {
      field: FIELD,
      operator: "lt",
      value: "2025",
    };
    const result = computeNewOverridesOnPin(FIELD, pinFilter, overrides);
    expect(result.filters).toHaveLength(1);
    expect(result.filters![0]).toEqual(pinFilter);
  });

  it("5d. preserves other fields' filters, sorts, and limit", () => {
    const otherFilter = filter(OTHER_FIELD, { value: "active" });
    const existingSort: InsightSort = { field: "name", direction: "asc" };
    const overrides: DashboardItemOverrides = {
      filters: [otherFilter],
      sorts: [existingSort],
      limit: 50,
    };
    const pinFilter: InsightFilterOverride = {
      field: FIELD,
      operator: "eq",
      value: "2024",
    };
    const result = computeNewOverridesOnPin(FIELD, pinFilter, overrides);
    // Other filter preserved.
    expect(result.filters).toContainEqual(otherFilter);
    // New pin added.
    expect(result.filters).toContainEqual(pinFilter);
    // Sorts and limit untouched.
    expect(result.sorts).toEqual([existingSort]);
    expect(result.limit).toBe(50);
  });
});

describe("computeNewOverridesOnClear — transition payload", () => {
  it("6a. adds cleared entry when there are no existing overrides", () => {
    const result = computeNewOverridesOnClear(FIELD, undefined);
    expect(result.filters).toHaveLength(1);
    expect(result.filters![0]).toMatchObject({ field: FIELD, cleared: true });
  });

  it("6b. replaces an existing pinned entry with cleared", () => {
    const existing = filter(FIELD, { value: "2024" });
    const overrides: DashboardItemOverrides = { filters: [existing] };
    const result = computeNewOverridesOnClear(FIELD, overrides);
    expect(result.filters).toHaveLength(1);
    expect(result.filters![0]).toMatchObject({ field: FIELD, cleared: true });
  });

  it("6c. preserves other fields' filters, sorts, and limit", () => {
    const otherFilter = filter(OTHER_FIELD, { value: "active" });
    const overrides: DashboardItemOverrides = {
      filters: [otherFilter],
      sorts: [{ field: "name", direction: "asc" }],
      limit: 20,
    };
    const result = computeNewOverridesOnClear(FIELD, overrides);
    expect(result.filters).toHaveLength(2);
    expect(result.filters).toContainEqual(otherFilter);
    expect(result.filters!.some((f) => f.field === FIELD && f.cleared)).toBe(
      true,
    );
    expect(result.sorts).toEqual([{ field: "name", direction: "asc" }]);
    expect(result.limit).toBe(20);
  });
});

describe("computeNewOverridesOnInherit — transition payload", () => {
  it("7a. removes a pinned entry; filters becomes undefined when empty", () => {
    const overrides: DashboardItemOverrides = {
      filters: [filter(FIELD, { value: "2024" })],
    };
    const result = computeNewOverridesOnInherit(FIELD, overrides);
    // Single-field bag: after removal filters should be undefined (not []).
    expect(result.filters).toBeUndefined();
  });

  it("7b. removes a cleared entry; filters becomes undefined when empty", () => {
    const overrides: DashboardItemOverrides = {
      filters: [filter(FIELD, { cleared: true, value: null })],
    };
    const result = computeNewOverridesOnInherit(FIELD, overrides);
    expect(result.filters).toBeUndefined();
  });

  it("7c. preserves other fields' filters when removing target field", () => {
    const otherFilter = filter(OTHER_FIELD, { value: "active" });
    const overrides: DashboardItemOverrides = {
      filters: [filter(FIELD, { value: "x" }), otherFilter],
    };
    const result = computeNewOverridesOnInherit(FIELD, overrides);
    expect(result.filters).toHaveLength(1);
    expect(result.filters![0]).toEqual(otherFilter);
  });

  it("7d. preserves sorts and limit when removing a filter", () => {
    const overrides: DashboardItemOverrides = {
      filters: [filter(FIELD, { value: "x" })],
      sorts: [{ field: "name", direction: "asc" }],
      limit: 10,
    };
    const result = computeNewOverridesOnInherit(FIELD, overrides);
    expect(result.sorts).toEqual([{ field: "name", direction: "asc" }]);
    expect(result.limit).toBe(10);
  });

  it("7e. no-op on a field with no override (safe to call from inherit state)", () => {
    const result = computeNewOverridesOnInherit(FIELD, undefined);
    expect(result.filters).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8–9: Sort + limit transition payloads
// ---------------------------------------------------------------------------

describe("computeNewOverridesOnSortChange — transition payload", () => {
  it("8a. sets a sort override from scratch", () => {
    const sorts: InsightSort[] = [{ field: "date", direction: "desc" }];
    const result = computeNewOverridesOnSortChange(sorts, undefined);
    expect(result.sorts).toEqual(sorts);
    expect(result.filters).toBeUndefined();
    expect(result.limit).toBeUndefined();
  });

  it("8b. replaces an existing sort override", () => {
    const overrides: DashboardItemOverrides = {
      sorts: [{ field: "name", direction: "asc" }],
    };
    const newSorts: InsightSort[] = [{ field: "date", direction: "desc" }];
    const result = computeNewOverridesOnSortChange(newSorts, overrides);
    expect(result.sorts).toEqual(newSorts);
  });

  it("8c. removes sort override when sorts is undefined (revert to inherit)", () => {
    const overrides: DashboardItemOverrides = {
      sorts: [{ field: "name", direction: "asc" }],
      limit: 100,
    };
    const result = computeNewOverridesOnSortChange(undefined, overrides);
    expect(result.sorts).toBeUndefined();
    expect(result.limit).toBe(100); // preserved
  });

  it("8d. preserves filters and limit when changing sorts", () => {
    const f = filter(FIELD, { value: "x" });
    const overrides: DashboardItemOverrides = { filters: [f], limit: 50 };
    const result = computeNewOverridesOnSortChange(
      [{ field: "date", direction: "asc" }],
      overrides,
    );
    expect(result.filters).toContainEqual(f);
    expect(result.limit).toBe(50);
  });
});

describe("computeNewOverridesOnLimitChange — transition payload", () => {
  it("9a. sets a limit override from scratch", () => {
    const result = computeNewOverridesOnLimitChange(25, undefined);
    expect(result.limit).toBe(25);
    expect(result.filters).toBeUndefined();
    expect(result.sorts).toBeUndefined();
  });

  it("9b. replaces an existing limit", () => {
    const overrides: DashboardItemOverrides = { limit: 100 };
    const result = computeNewOverridesOnLimitChange(50, overrides);
    expect(result.limit).toBe(50);
  });

  it("9c. removes limit override when limit is undefined (revert to inherit)", () => {
    const overrides: DashboardItemOverrides = {
      limit: 100,
      sorts: [{ field: "name", direction: "asc" }],
    };
    const result = computeNewOverridesOnLimitChange(undefined, overrides);
    expect(result.limit).toBeUndefined();
    expect(result.sorts).toEqual([{ field: "name", direction: "asc" }]); // preserved
  });

  it("9d. preserves filters and sorts when changing limit", () => {
    const f = filter(FIELD, { value: "x" });
    const s: InsightSort = { field: "date", direction: "asc" };
    const overrides: DashboardItemOverrides = { filters: [f], sorts: [s] };
    const result = computeNewOverridesOnLimitChange(10, overrides);
    expect(result.filters).toContainEqual(f);
    expect(result.sorts).toContainEqual(s);
  });
});

// ---------------------------------------------------------------------------
// 10: Badge helper
// ---------------------------------------------------------------------------

describe("hasOverrides — badge truth table", () => {
  it("10a. undefined → false", () => {
    expect(hasOverrides(undefined)).toBe(false);
  });

  it("10b. empty object {} → false", () => {
    expect(hasOverrides({})).toBe(false);
  });

  it("10c. filters: [] → false (empty array is non-trivial check)", () => {
    expect(hasOverrides({ filters: [] })).toBe(false);
  });

  it("10d. non-empty filters → true", () => {
    expect(hasOverrides({ filters: [filter(FIELD)] })).toBe(true);
  });

  it("10e. cleared filter entry → true (cleared is an active override)", () => {
    expect(
      hasOverrides({
        filters: [filter(FIELD, { cleared: true, value: null })],
      }),
    ).toBe(true);
  });

  it("10f. sorts override → true", () => {
    expect(hasOverrides({ sorts: [{ field: "date", direction: "asc" }] })).toBe(
      true,
    );
  });

  it("10g. limit override → true", () => {
    expect(hasOverrides({ limit: 100 })).toBe(true);
  });

  it("10h. only sorts=undefined, limit=undefined → false", () => {
    // Explicitly undefined properties still yield false.
    expect(hasOverrides({ sorts: undefined, limit: undefined })).toBe(false);
  });
});
