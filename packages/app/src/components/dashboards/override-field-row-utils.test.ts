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
 * SORT ROW — a tile sort override holds one key:
 * 11. sortKeyToPin: Pin saves one key, by a reference the field select shows.
 * 12. formatSortKeys: names every key in priority order.
 * 13. buildSortFieldOptions: every stored reference form maps to one option;
 *     only what the Insight's viewer sort allows is offered.
 *
 * BADGE — hasOverrides truth table.
 * 10. hasOverrides: true on non-empty filters/sorts/limit, false otherwise.
 *
 * OFFER — which rows a tile gets, from what its Insight declares for viewers:
 * 14. overrideOffer: editable when declared, reset-only for an undeclared
 *     override the tile already holds, hidden otherwise.
 * 15. resolveFilterRow: the declared filter a field row edits, resolved for a
 *     held override as the tile runtime resolves it.
 * 17. controlCanDrive: whether a dashboard control can be bound to a row.
 * 16. clampLimit: a limit inside the range the Insight offers.
 */

import type {
  DashboardControl,
  DashboardItemOverrides,
  InsightFilter,
  InsightFilterOverride,
  InsightSort,
} from "@dashframe/types";
import { describe, expect, it } from "vite-plus/test";
import {
  buildSortFieldOptions,
  clampLimit,
  computeNewOverridesOnClear,
  computeNewOverridesOnInherit,
  computeNewOverridesOnLimitChange,
  computeNewOverridesOnPin,
  computeNewOverridesOnSortChange,
  deriveFieldState,
  formatSortKeys,
  hasOverrides,
  controlCanDrive,
  overrideOffer,
  resolveFilterRow,
  sortKeyToPin,
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
  it("preserves the declared saved-filter ID for runtime lookup", () => {
    const result = computeNewOverridesOnClear(FIELD, undefined, "filter-1");
    expect(result.filters?.[0]).toMatchObject({
      id: "filter-1",
      field: FIELD,
      cleared: true,
    });
  });
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

// ---------------------------------------------------------------------------
// Sort row
// ---------------------------------------------------------------------------

const fieldId = "11111111-1111-4111-8111-111111111111";
const fieldAlias = "field_11111111_1111_4111_8111_111111111111";
const metricId = "22222222-2222-4222-8222-222222222222";
const metricAlias = "metric_22222222_2222_4222_8222_222222222222";

describe("sortKeyToPin — what Pin saves", () => {
  const fields = buildSortFieldOptions(
    [{ id: fieldId, name: "Region", columnName: "region" }],
    [{ id: metricId, name: "Revenue" }],
  );

  it("11a. stores the Insight's field alias as the option's reference", () => {
    expect(
      sortKeyToPin([{ field: fieldAlias, direction: "desc" }], fields),
    ).toEqual({ field: fieldId, direction: "desc" });
  });

  it("11b. stores the Insight's metric alias as the option's reference", () => {
    expect(
      sortKeyToPin([{ field: metricAlias, direction: "asc" }], fields),
    ).toEqual({ field: metricId, direction: "asc" });
  });

  it.each([fieldAlias, metricAlias, "region", "Revenue"])(
    "11c. saves a reference the field select offers, for an Insight sorted by %s",
    (field) => {
      const pinned = sortKeyToPin([{ field, direction: "asc" }], fields)!;
      expect(fields.options.map((option) => option.value)).toContain(
        pinned.field,
      );
    },
  );

  it("11d. saves only the first key of a multi-key Insight sort, without its pivot cell", () => {
    expect(
      sortKeyToPin(
        [
          {
            field: metricAlias,
            direction: "desc",
            pivotValues: [{ fieldId, value: "Web" }],
          },
          { field: fieldAlias, direction: "asc" },
        ],
        fields,
      ),
    ).toEqual({ field: metricId, direction: "desc" });
  });

  it("11e. falls back to the first option when the Insight has no sort, or one it cannot name", () => {
    expect(sortKeyToPin(undefined, fields)).toEqual({
      field: fieldId,
      direction: "asc",
    });
    expect(
      sortKeyToPin([{ field: "field_gone", direction: "desc" }], fields),
    ).toEqual({ field: fieldId, direction: "desc" });
  });

  it("11g. pins a field the Insight allows when its own sort is on one it does not", () => {
    const regionOnly = buildSortFieldOptions(
      [{ id: fieldId, name: "Region", columnName: "region" }],
      [{ id: metricId, name: "Revenue" }],
      [fieldId],
    );
    expect(
      sortKeyToPin([{ field: metricAlias, direction: "desc" }], regionOnly),
    ).toEqual({ field: fieldId, direction: "desc" });
  });

  it("11f. saves nothing when there is nothing to sort by", () => {
    expect(
      sortKeyToPin(
        [{ field: fieldAlias, direction: "asc" }],
        buildSortFieldOptions([], []),
      ),
    ).toBeUndefined();
  });
});

describe("formatSortKeys", () => {
  it("12a. names every key in priority order", () => {
    expect(
      formatSortKeys([
        { field: "region", direction: "asc" },
        { field: "order_date", direction: "desc" },
      ]),
    ).toBe("region asc, order_date desc");
  });

  it("12b. names a pivot key's cell so keys on one metric stay distinct", () => {
    expect(
      formatSortKeys([
        {
          field: "revenue",
          direction: "desc",
          pivotValues: [{ fieldId: "channel", value: "Web" }],
        },
        {
          field: "revenue",
          direction: "desc",
          pivotValues: [{ fieldId: "channel", value: null }],
        },
      ]),
    ).toBe("revenue · Web desc, revenue · (empty) desc");
  });

  it("12c. shows a known reference by its label and any other as stored", () => {
    expect(
      formatSortKeys(
        [
          { field: fieldAlias, direction: "asc" },
          { field: "order_date", direction: "desc" },
        ],
        buildSortFieldOptions([{ id: fieldId, name: "region" }], [])
          .byReference,
      ),
    ).toBe("region asc, order_date desc");
  });
});

describe("buildSortFieldOptions", () => {
  it("13a. maps a field's id, alias, and column name to one option valued by id", () => {
    const { options, byReference } = buildSortFieldOptions(
      [
        {
          id: fieldId,
          name: "region",
          columnName: "region_code",
          displayName: "orders.region",
        },
      ],
      [],
    );
    expect(options).toEqual([{ value: fieldId, label: "orders.region" }]);
    expect(
      [fieldId, fieldAlias, "region_code"].map((reference) =>
        byReference.get(reference),
      ),
    ).toEqual([options[0], options[0], options[0]]);
  });

  it("13b. maps a metric's id, alias, and name to one option valued by id", () => {
    const { options, byReference } = buildSortFieldOptions(
      [],
      [{ id: metricId, name: "Revenue" }],
    );
    expect(options).toEqual([{ value: metricId, label: "Revenue" }]);
    expect(
      [metricId, metricAlias, "Revenue"].map((reference) =>
        byReference.get(reference),
      ),
    ).toEqual([options[0], options[0], options[0]]);
  });

  it("13c. names a field of an insight built on another insight, whose column name is an alias", () => {
    // The upstream insight's metric arrives as a field whose column name is the
    // generated alias; only `name` is readable.
    const { byReference } = buildSortFieldOptions(
      [{ id: metricId, name: "Total Revenue", columnName: metricAlias }],
      [],
    );
    expect(
      formatSortKeys([{ field: metricAlias, direction: "desc" }], byReference),
    ).toBe("Total Revenue desc");
  });

  it("13d. keeps joined fields that share a column name apart, and names the shared name by the field the tile sorts by", () => {
    const joined = [
      { id: fieldId, name: "id", columnName: "id", displayName: "orders.id" },
      { id: metricId, name: "id", columnName: "id", displayName: "users.id" },
    ];
    const { options, byReference } = buildSortFieldOptions(joined, []);
    expect(options.map((option) => option.label)).toEqual([
      "orders.id",
      "users.id",
    ]);
    expect(byReference.get("id")?.label).toBe("orders.id");
    expect(byReference.get(metricId)?.label).toBe("users.id");
    // The tile takes the first allowed field the name names.
    expect(
      buildSortFieldOptions(joined, [], [metricId]).byReference.get("id")
        ?.label,
    ).toBe("users.id");
  });

  it("13f. offers only what the Insight's viewer sort allows, and still names the rest", () => {
    const { options, byReference } = buildSortFieldOptions(
      [{ id: fieldId, name: "Region", columnName: "region" }],
      [{ id: metricId, name: "Revenue" }],
      [fieldId],
    );
    expect(options).toEqual([{ value: fieldId, label: "Region" }]);
    expect(byReference.get(metricAlias)?.label).toBe("Revenue");
  });

  it("13g. offers nothing when the Insight's viewer sort allows nothing known", () => {
    expect(
      buildSortFieldOptions([{ id: fieldId, name: "Region" }], [], []).options,
    ).toEqual([]);
  });

  it("13e. lists fields before metrics", () => {
    expect(
      buildSortFieldOptions(
        [{ id: fieldId, name: "Region" }],
        [{ id: metricId, name: "Revenue" }],
      ).options.map((option) => option.label),
    ).toEqual(["Region", "Revenue"]);
  });
});

// ---------------------------------------------------------------------------
// 14–16: What a tile is offered
// ---------------------------------------------------------------------------

describe("overrideOffer — which row a control gets", () => {
  it.each([
    { declared: true, held: false, offer: "editable" },
    { declared: true, held: true, offer: "editable" },
    { declared: false, held: true, offer: "resetOnly" },
    { declared: false, held: false, offer: "hidden" },
  ])(
    "14. declared=$declared, held=$held → $offer",
    ({ declared, held, offer }) => {
      expect(overrideOffer(declared, held)).toBe(offer);
    },
  );
});

describe("resolveFilterRow — the declared filter a row edits", () => {
  const fieldId = "20000000-0000-4000-8000-000000000001";
  const alias = "field_20000000_0000_4000_8000_000000000001";
  // Two saved filters on one field, as a range has.
  const range = [
    { id: "filter-1", field: FIELD, operator: "gte" as const, value: 10 },
    { id: "filter-2", field: FIELD, operator: "lte" as const, value: 20 },
  ];
  const minimum = { key: "minimum", filterId: "filter-1", label: "Minimum" };
  const maximum = {
    key: "maximum",
    filterId: "filter-2",
    label: "Maximum",
    allowClear: true,
  };
  type Runtime = NonNullable<
    Parameters<typeof resolveFilterRow>[2]["runtimeControls"]
  >["filters"];
  const row = (
    held: InsightFilterOverride | undefined,
    filters: InsightFilter[],
    runtime: Runtime,
    fields?: Parameters<typeof resolveFilterRow>[3],
  ) =>
    resolveFilterRow(
      FIELD,
      held,
      { filters, runtimeControls: { filters: runtime } },
      fields,
    );

  it("15a. returns the field's one declaration with the saved filter it varies", () => {
    expect(row(undefined, range, [maximum])).toEqual({
      declaration: maximum,
      filter: range[1],
    });
  });

  it("15b. clears the declared second predicate when two saved filters share a field", () => {
    const declaredId = row(undefined, range, [maximum])?.declaration.filterId;
    const result = computeNewOverridesOnClear(FIELD, undefined, declaredId);
    expect(result.filters?.[0]).toMatchObject({
      id: "filter-2",
      field: FIELD,
      cleared: true,
    });
  });

  it.each([
    {
      name: "two declarations target the same field",
      runtime: [minimum, maximum],
    },
    { name: "the field is undeclared", runtime: [] },
    { name: "the Insight declares no runtime filters", runtime: undefined },
    {
      name: "the declaration references a missing predicate",
      runtime: [{ key: "missing", filterId: "missing", label: "Missing" }],
    },
  ])("15c. does not guess, with nothing held, when $name", ({ runtime }) => {
    expect(row(undefined, range, runtime)).toBeUndefined();
  });

  it("15d. takes the declaration a held override runs through when a field has two", () => {
    const both = [minimum, maximum];
    // By the saved filter's id, whatever operator the override carries.
    expect(
      row(filter(FIELD, { id: "filter-2", operator: "eq" }), range, both),
    ).toEqual({ declaration: maximum, filter: range[1] });
    // Without an id, by the operator, as the tile runtime does.
    expect(row(filter(FIELD, { operator: "gte" }), range, both)).toEqual({
      declaration: minimum,
      filter: range[0],
    });
    // An equality matches neither bound, and a clear matches both.
    expect(row(filter(FIELD), range, both)).toBeUndefined();
    expect(row(filter(FIELD, { cleared: true }), range, both)).toBeUndefined();
  });

  it("15e. has no declaration for a held override the tile cannot run", () => {
    // One declared filter, but the override carries another operator.
    expect(row(filter(FIELD), range, [maximum])).toBeUndefined();
    // Or the id of a filter that is not declared.
    expect(
      row(filter(FIELD, { id: "filter-1", operator: "gte" }), range, [maximum]),
    ).toBeUndefined();
  });

  it("15f. has no declaration for a held override whose id names another field's filter", () => {
    const saved = [
      { id: "filter-1", field: OTHER_FIELD, operator: "eq" as const, value: 1 },
    ];
    expect(
      row(filter(FIELD, { id: "filter-1" }), saved, [minimum]),
    ).toBeUndefined();
  });

  it("15g. finds a saved filter stored by the field's result-column alias", () => {
    const saved = [
      { id: "filter-1", field: alias, operator: "eq" as const, value: 1 },
    ];
    const fields = [{ id: fieldId, name: "Created", columnName: FIELD }];
    const declared = { declaration: minimum, filter: saved[0] };

    expect(row(undefined, saved, [minimum], fields)).toEqual(declared);
    // A control bound by column name runs through it too.
    expect(row(filter(FIELD), saved, [minimum], fields)).toEqual(declared);
    // Without the fields the alias names nothing.
    expect(row(undefined, saved, [minimum])).toBeUndefined();
    // Another field's alias is not this row's.
    expect(
      resolveFilterRow(
        OTHER_FIELD,
        undefined,
        { filters: saved, runtimeControls: { filters: [minimum] } },
        fields,
      ),
    ).toBeUndefined();
  });
});

describe("controlCanDrive — whether a control may be bound to a row", () => {
  const equality: InsightFilter = {
    id: "filter-1",
    field: FIELD,
    operator: "eq",
    value: "a",
  };
  const clearable = {
    key: "k",
    filterId: "filter-1",
    label: "Created",
    allowClear: true,
  };
  /** Whether a control can drive the first declaration of `declarations`. */
  const drives = (
    filters: InsightFilter[],
    declarations: (typeof clearable | Omit<typeof clearable, "allowClear">)[],
  ) =>
    controlCanDrive(
      FIELD,
      { declaration: declarations[0]!, filter: filters[0]! },
      { filters, runtimeControls: { filters: declarations } },
    );

  it("17a. an equality that allows clearing", () => {
    expect(drives([equality], [clearable])).toBe(true);
  });

  it("17b. not one that does not allow clearing: a blank control sends a clear", () => {
    const { allowClear: _allowClear, ...fixed } = clearable;
    expect(drives([equality], [fixed])).toBe(false);
  });

  it("17c. not a required filter", () => {
    expect(drives([equality], [{ ...clearable, required: true }])).toBe(false);
  });

  it("17d. not a filter that is not an equality: a control sends one", () => {
    expect(drives([{ ...equality, operator: "gte" }], [clearable])).toBe(false);
  });

  it("17e. not when another declared filter on the field would take the control's override", () => {
    const second = { ...clearable, key: "k2", filterId: "filter-2" };
    // A second equality: the control's value matches both.
    expect(
      drives([equality, { ...equality, id: "filter-2" }], [clearable, second]),
    ).toBe(false);
    // Another operator: the value finds the equality, but a blank control's
    // clear matches both.
    expect(
      drives(
        [equality, { ...equality, id: "filter-2", operator: "gte" }],
        [clearable, second],
      ),
    ).toBe(false);
  });
});

describe("clampLimit", () => {
  const bounds = { min: 10, max: 50 };

  it.each([
    { limit: 5, clamped: 10 },
    { limit: 10, clamped: 10 },
    { limit: 25, clamped: 25 },
    { limit: 50, clamped: 50 },
    { limit: 900, clamped: 50 },
  ])("16a. moves $limit to $clamped within 10–50", ({ limit, clamped }) => {
    expect(clampLimit(limit, bounds)).toBe(clamped);
  });

  it("16b. leaves the limit alone when there is no range", () => {
    expect(clampLimit(900, undefined)).toBe(900);
  });
});
