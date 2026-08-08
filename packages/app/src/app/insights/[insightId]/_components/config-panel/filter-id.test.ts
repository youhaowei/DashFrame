import type { InsightFilter } from "@dashframe/types";
import { describe, expect, it } from "vitest";
import {
  applyFilterSave,
  deriveFilterId,
  NEW_FILTER_ID,
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
  it("uses the persisted id", () => {
    const f: InsightFilter = {
      id: "uuid-1",
      field: "amount",
      operator: "eq",
      value: 1,
    };
    expect(deriveFilterId(f)).toBe("uuid-1");
  });

  it("rejects a filter without a persisted id", () => {
    const f: InsightFilter = { field: "amount", operator: "eq", value: 1 };
    expect(() => deriveFilterId(f)).toThrow("missing its persisted id");
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

  it("keeps an API-created filter idempotent after reorder", () => {
    // The API receives id-less filters from an agent, stamps persisted ids, and
    // the UI then derives `_id` solely from that stored identity.
    const receivedByApi: InsightFilter[] = [
      { field: "region", operator: "eq", value: "north" },
      { field: "amount", operator: "gt", value: 100 },
    ];
    const persisted: InsightFilter[] = [
      { ...receivedByApi[0], id: "api-region" },
      { ...receivedByApi[1], id: "api-amount" },
    ];
    const beforeEdit = withFilterIds(persisted);
    const openedForEdit = beforeEdit[1];

    const reordered = withFilterIds([persisted[1], persisted[0]]);
    const saved: FilterWithId = { ...openedForEdit, value: 200 };
    const result = applyFilterSave(reordered, saved);

    expect(result).toHaveLength(2);
    expect(result.filter((filter) => filter.id === "api-amount")).toEqual([
      expect.objectContaining({ value: 200 }),
    ]);
  });
});

describe("prepareFilterForSave — distinct id per Add (data-loss guard)", () => {
  it("assigns a fresh id (and matching _id) to a new-draft filter", () => {
    const draftNew: FilterWithId = {
      _id: NEW_FILTER_ID,
      field: "amount",
      operator: "eq",
      value: 1,
    };
    const stamped = prepareFilterForSave(draftNew, () => "uuid-fresh");
    expect(stamped.id).toBe("uuid-fresh");
    expect(stamped._id).toBe("uuid-fresh");
  });

  it("leaves an existing filter's id and _id intact on edit", () => {
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

  it("keeps an existing filter's stable id while editing", () => {
    const list = withFilterIds([
      { id: "uuid-region", field: "region", operator: "eq", value: "north" },
    ]);
    const openedForEdit = list[0];
    expect(openedForEdit.id).toBe("uuid-region");
    expect(openedForEdit._id).toBe("uuid-region");

    const saved = prepareFilterForSave(
      { ...openedForEdit, value: "south" },
      () => "uuid-SHOULD-NOT-USE",
    );
    expect(saved._id).toBe("uuid-region");
    expect(saved.id).toBe("uuid-region");

    const result = applyFilterSave(list, saved);
    expect(result).toHaveLength(1); // updated in place, NOT duplicated
    expect(result[0].value).toBe("south");
    expect(result[0].id).toBe("uuid-region");
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
      { _id: NEW_FILTER_ID, field: "amount", operator: "eq", value: 1 },
      gen,
    );
    list = applyFilterSave(list, a);

    // Re-derive client ids from the persisted list (as InsightConfigPanel does
    // after the array updates), then Add filter B from a fresh "new" draft.
    list = withFilterIds(list);
    const b = prepareFilterForSave(
      { _id: NEW_FILTER_ID, field: "region", operator: "eq", value: "north" },
      gen,
    );
    list = applyFilterSave(list, b);

    // BOTH filters persist, with distinct ids — no overwrite.
    expect(list).toHaveLength(2);
    expect(list.map((f) => f.id).sort()).toEqual(["uuid-A", "uuid-B"]);
    expect(list.find((f) => f.id === "uuid-A")?.value).toBe(1);
    expect(list.find((f) => f.id === "uuid-B")?.value).toBe("north");
  });

  it("keeps a legacy id-less filter's identity stable across a refetch", () => {
    // Rows stored before filters carried persisted ids. Hydration runs again on
    // every subscription update, so an identity minted per hydration would
    // differ between the list the dialog opened from and the list its save
    // merges into, and the save would append a duplicate instead of updating.
    const stored = [{ field: "amount", operator: "eq" as const, value: 1 }];

    const opened = withFilterIds(stored)[0]!;
    const afterRefetch = withFilterIds(stored);

    const saved = prepareFilterForSave({ ...opened, value: 2 });
    const merged = applyFilterSave(afterRefetch, saved);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.value).toBe(2);
    // The derived identity is promoted to the persisted id, so the next write
    // stores it and the row stops being legacy.
    expect(merged[0]!.id).toBe(opened._id);
  });

  it("keeps legacy identities stable when the stored order changes", () => {
    // A concurrent update can reorder the array. Identity must follow the
    // predicate, not its index, or the edit misroutes to its neighbour.
    const a = { field: "amount", operator: "eq" as const, value: 1 };
    const b = { field: "region", operator: "eq" as const, value: "north" };

    const opened = withFilterIds([a, b])[0]!;
    const reordered = withFilterIds([b, a]);

    const merged = applyFilterSave(
      reordered,
      prepareFilterForSave({ ...opened, value: 2 }),
    );

    expect(merged).toHaveLength(2);
    expect(merged.find((f) => f.field === "amount")?.value).toBe(2);
    expect(merged.find((f) => f.field === "region")?.value).toBe("north");
  });
});
