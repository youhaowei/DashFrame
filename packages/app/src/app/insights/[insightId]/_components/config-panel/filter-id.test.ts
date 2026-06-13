import type { InsightFilter } from "@dashframe/types";
import { describe, expect, it } from "vitest";
import {
  applyFilterSave,
  deriveFilterId,
  prepareFilterForSave,
  withFilterIds,
} from "./filter-id";
import type { FilterWithId } from "./FiltersSection";

/**
 * Locks the stable-identity contract for in-flight filter edits. The bug class:
 * an index-derived id goes stale if a subscription reorders the array between
 * opening the editor and saving, routing the edit to the wrong predicate. The
 * fix sources `_id` from the persisted filter `id`, which travels with the
 * filter regardless of array position.
 */

describe("deriveFilterId", () => {
  it("uses the persisted id when present", () => {
    const f: InsightFilter = {
      id: "uuid-1",
      field: "amount",
      operator: "eq",
      value: 1,
    };
    expect(deriveFilterId(f, 3)).toBe("uuid-1");
  });

  it("falls back to a content+index key when id is absent", () => {
    const f: InsightFilter = { field: "amount", operator: "eq", value: 1 };
    expect(deriveFilterId(f, 2)).toBe("amount-eq-2");
  });
});

describe("applyFilterSave with a stable persisted id", () => {
  it("routes the save to the correct predicate after a concurrent reorder", () => {
    // Open the editor for filter B (id uuid-b) when the list is [A, B, C].
    const original: InsightFilter[] = [
      { id: "uuid-a", field: "region", operator: "eq", value: "north" },
      { id: "uuid-b", field: "amount", operator: "gt", value: 100 },
      { id: "uuid-c", field: "status", operator: "eq", value: "open" },
    ];
    const beforeEdit = withFilterIds(original);
    const openedForEdit = beforeEdit[1]; // filter B
    expect(openedForEdit._id).toBe("uuid-b");

    // A subscription fires mid-edit and reorders the array to [C, B, A].
    const reordered: InsightFilter[] = [original[2], original[1], original[0]];
    const afterReorder = withFilterIds(reordered);

    // User saves an edit to B (value 100 → 200), carrying B's stable _id.
    const saved: FilterWithId = { ...openedForEdit, value: 200 };
    const result = applyFilterSave(afterReorder, saved);

    // The list length is unchanged — no duplicate appended.
    expect(result).toHaveLength(3);
    // B was updated in place (still at its reordered position), not duplicated.
    const updatedB = result.filter((f) => f._id === "uuid-b");
    expect(updatedB).toHaveLength(1);
    expect(updatedB[0].value).toBe(200);
    // A and C are untouched.
    expect(result.find((f) => f._id === "uuid-a")?.value).toBe("north");
    expect(result.find((f) => f._id === "uuid-c")?.value).toBe("open");
  });

  it("appends a brand-new filter that is not yet in the list", () => {
    const current = withFilterIds([
      { id: "uuid-a", field: "region", operator: "eq", value: "north" },
    ]);
    const fresh: FilterWithId = {
      id: "uuid-new",
      _id: "uuid-new",
      field: "amount",
      operator: "gt",
      value: 10,
    };
    const result = applyFilterSave(current, fresh);
    expect(result).toHaveLength(2);
    expect(result[1]._id).toBe("uuid-new");
  });

  it("with index-based fallback ids, a reorder would misroute (regression guard)", () => {
    // This documents WHY persisted ids matter: without them, the same reorder
    // scenario fails to find the edited filter and appends a duplicate.
    const original: InsightFilter[] = [
      { field: "region", operator: "eq", value: "north" },
      { field: "amount", operator: "gt", value: 100 },
    ];
    const beforeEdit = withFilterIds(original); // ids: region-eq-0, amount-gt-1
    const openedForEdit = beforeEdit[1]; // amount-gt-1

    // Reorder to [amount, region] → amount is now index 0 → id amount-gt-0.
    const reordered = withFilterIds([original[1], original[0]]);
    const saved: FilterWithId = { ...openedForEdit, value: 200 };
    const result = applyFilterSave(reordered, saved);

    // The stale id "amount-gt-1" no longer matches → duplicate appended.
    expect(result).toHaveLength(3);
  });
});

describe("prepareFilterForSave — distinct id per Add (data-loss guard)", () => {
  it("assigns a fresh id to a new filter and leaves an existing filter's id intact", () => {
    const draftNew: FilterWithId = {
      _id: "__new__",
      field: "amount",
      operator: "eq",
      value: 1,
    };
    const stamped = prepareFilterForSave(draftNew, () => "uuid-fresh");
    expect(stamped.id).toBe("uuid-fresh");
    expect(stamped._id).toBe("uuid-fresh");

    const existing: FilterWithId = {
      id: "uuid-existing",
      _id: "uuid-existing",
      field: "region",
      operator: "eq",
      value: "north",
    };
    const reStamped = prepareFilterForSave(
      existing,
      () => "uuid-SHOULD-NOT-USE",
    );
    expect(reStamped.id).toBe("uuid-existing");
    expect(reStamped._id).toBe("uuid-existing");
  });

  it("two consecutive Adds yield distinct ids — second does NOT overwrite first", () => {
    // Repro of the data-loss bug: FilterEditDialog is permanently mounted, so a
    // mount-scoped id would be reused. prepareFilterForSave generates per save,
    // so Add A then Add B produce two distinct filters.
    const ids = ["uuid-A", "uuid-B"];
    let i = 0;
    const gen = () => ids[i++];

    let list: FilterWithId[] = [];

    // Add filter A.
    const a = prepareFilterForSave(
      { _id: "__new__", field: "amount", operator: "eq", value: 1 },
      gen,
    );
    list = applyFilterSave(list, a);

    // Re-derive client ids from the persisted list (as InsightConfigPanel does
    // after the array updates), then Add filter B from a fresh "new" draft.
    list = withFilterIds(list);
    const b = prepareFilterForSave(
      { _id: "__new__", field: "region", operator: "eq", value: "north" },
      gen,
    );
    list = applyFilterSave(list, b);

    // BOTH filters persist, with distinct ids — no overwrite.
    expect(list).toHaveLength(2);
    expect(list.map((f) => f.id).sort()).toEqual(["uuid-A", "uuid-B"]);
    expect(list.find((f) => f.id === "uuid-A")?.value).toBe(1);
    expect(list.find((f) => f.id === "uuid-B")?.value).toBe("north");
  });
});
