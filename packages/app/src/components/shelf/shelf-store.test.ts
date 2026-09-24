/**
 * The shelf store: what putting, pinning, and removing do to the stored list,
 * and how another tab's write reaches this one.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  SHELF_RECENT_LIMIT,
  parseShelf,
  putOnShelf,
  readShelf,
  removeFromShelf,
  setShelfItemPinned,
  shelfStorageKey,
  useShelfItems,
  type ShelfItemRef,
} from "./shelf-store";

function metric(n: number): ShelfItemRef {
  return { kind: "metric", id: `m${n}`, scope: "t1", label: `Metric ${n}` };
}

const P1 = shelfStorageKey("p1");
const labels = () => readShelf(P1).map((item) => item.label);

describe("shelf store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("puts the newest item first and moves a repeat to the front", () => {
    putOnShelf(P1, metric(1));
    putOnShelf(P1, metric(2));
    putOnShelf(P1, { ...metric(1), label: "Renamed 1" });
    expect(labels()).toEqual(["Renamed 1", "Metric 2"]);
  });

  it("drops the oldest unpinned item past the recent limit, never a pinned one", () => {
    putOnShelf(P1, metric(0));
    setShelfItemPinned(P1, "metric:m0", true);
    for (let n = 1; n <= SHELF_RECENT_LIMIT + 1; n++) putOnShelf(P1, metric(n));

    const items = readShelf(P1);
    expect(items.filter((item) => !item.pinned)).toHaveLength(
      SHELF_RECENT_LIMIT,
    );
    expect(labels()).toContain("Metric 0");
    // Metric 1 was the oldest recent item.
    expect(labels()).not.toContain("Metric 1");
  });

  it("keeps a pin when the item is put on the shelf again", () => {
    putOnShelf(P1, metric(1));
    setShelfItemPinned(P1, "metric:m1", true);
    putOnShelf(P1, metric(1));
    expect(readShelf(P1)[0]).toMatchObject({ id: "m1", pinned: true });
  });

  it("makes an unpinned item the newest recent one, so the limit keeps it", () => {
    putOnShelf(P1, metric(0));
    setShelfItemPinned(P1, "metric:m0", true);
    for (let n = 1; n <= SHELF_RECENT_LIMIT; n++) putOnShelf(P1, metric(n));

    setShelfItemPinned(P1, "metric:m0", false);
    expect(readShelf(P1)[0]).toMatchObject({ id: "m0", pinned: false });
    expect(labels()).toContain("Metric 0");
    expect(readShelf(P1)).toHaveLength(SHELF_RECENT_LIMIT);
  });

  it("keeps each project's and account's shelf apart, and refuses with no key", () => {
    const p2 = shelfStorageKey("p2");
    const p1Other = shelfStorageKey("p1", "someone-else");
    putOnShelf(P1, metric(1));
    expect(readShelf(p2)).toEqual([]);
    expect(readShelf(p1Other)).toEqual([]);
    putOnShelf(p2, metric(2));
    expect(readShelf(null)).toEqual([]);
    expect(putOnShelf(null, metric(3))).toBe(false);
    expect(labels()).toEqual(["Metric 1"]);
  });

  it("removes an item by key", () => {
    putOnShelf(P1, metric(1));
    putOnShelf(P1, metric(2));
    removeFromShelf(P1, "metric:m1");
    expect(labels()).toEqual(["Metric 2"]);
  });

  it("ignores malformed and duplicate stored entries", () => {
    const raw = JSON.stringify([
      { kind: "metric", id: "a", scope: "t", label: "A", pinned: false },
      { kind: "metric", id: "a", scope: "t", label: "Again", pinned: true },
      { kind: "report", id: "b", scope: "t", label: "B", pinned: false },
      { kind: "field", id: "f", scope: "t", label: "F", pinned: false },
      { kind: "chart", id: "c", label: "No scope", pinned: false },
      "junk",
    ]);
    expect(parseShelf(raw).map((item) => item.label)).toEqual(["A"]);
    expect(parseShelf("{not json")).toEqual([]);
  });

  it("shows another tab's write without a reload, and builds on it", () => {
    const { result } = renderHook(() => useShelfItems(P1));
    expect(result.current).toEqual([]);

    // Another tab writes the shelf; this tab hears only the storage event.
    act(() => {
      window.localStorage.setItem(
        P1,
        JSON.stringify([{ ...metric(7), pinned: true }]),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: P1 }));
    });
    expect(result.current.map((item) => item.label)).toEqual(["Metric 7"]);

    // This tab's next change starts from the other tab's list.
    act(() => {
      putOnShelf(P1, metric(8));
    });
    expect(result.current.map((item) => item.label)).toEqual([
      "Metric 8",
      "Metric 7",
    ]);
  });
});
