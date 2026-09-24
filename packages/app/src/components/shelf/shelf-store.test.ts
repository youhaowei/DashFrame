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
  setShelfProject,
  shelfStorageKey,
  useShelfItems,
  type ShelfItemRef,
} from "./shelf-store";

function metric(n: number): ShelfItemRef {
  return { kind: "metric", id: `m${n}`, scope: "t1", label: `Metric ${n}` };
}

const labels = () => readShelf().map((item) => item.label);

const SHELF_STORAGE_KEY = shelfStorageKey("p1");

describe("shelf store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setShelfProject("p1");
  });

  it("puts the newest item first and moves a repeat to the front", () => {
    putOnShelf(metric(1));
    putOnShelf(metric(2));
    putOnShelf({ ...metric(1), label: "Renamed 1" });
    expect(labels()).toEqual(["Renamed 1", "Metric 2"]);
  });

  it("drops the oldest unpinned item past the recent limit, never a pinned one", () => {
    putOnShelf(metric(0));
    setShelfItemPinned("metric:m0", true);
    for (let n = 1; n <= SHELF_RECENT_LIMIT + 1; n++) putOnShelf(metric(n));

    const items = readShelf();
    expect(items.filter((item) => !item.pinned)).toHaveLength(
      SHELF_RECENT_LIMIT,
    );
    expect(labels()).toContain("Metric 0");
    // Metric 1 was the oldest recent item.
    expect(labels()).not.toContain("Metric 1");
  });

  it("keeps a pin when the item is put on the shelf again", () => {
    putOnShelf(metric(1));
    setShelfItemPinned("metric:m1", true);
    putOnShelf(metric(1));
    expect(readShelf()[0]).toMatchObject({ id: "m1", pinned: true });
  });

  it("makes an unpinned item the newest recent one, so the limit keeps it", () => {
    putOnShelf(metric(0));
    setShelfItemPinned("metric:m0", true);
    for (let n = 1; n <= SHELF_RECENT_LIMIT; n++) putOnShelf(metric(n));

    setShelfItemPinned("metric:m0", false);
    expect(readShelf()[0]).toMatchObject({ id: "m0", pinned: false });
    expect(labels()).toContain("Metric 0");
    expect(readShelf()).toHaveLength(SHELF_RECENT_LIMIT);
  });

  it("keeps each project's shelf apart, and reads empty with no project", () => {
    putOnShelf(metric(1));
    setShelfProject("p2");
    expect(readShelf()).toEqual([]);
    putOnShelf(metric(2));
    setShelfProject(null);
    expect(readShelf()).toEqual([]);
    expect(putOnShelf(metric(3))).toBe(false);
    setShelfProject("p1");
    expect(labels()).toEqual(["Metric 1"]);
  });

  it("removes an item by key", () => {
    putOnShelf(metric(1));
    putOnShelf(metric(2));
    removeFromShelf("metric:m1");
    expect(labels()).toEqual(["Metric 2"]);
  });

  it("ignores malformed and duplicate stored entries", () => {
    const raw = JSON.stringify([
      { kind: "metric", id: "a", scope: "t", label: "A", pinned: false },
      { kind: "metric", id: "a", scope: "t", label: "Again", pinned: true },
      { kind: "report", id: "b", scope: "t", label: "B", pinned: false },
      { kind: "chart", id: "c", label: "No scope", pinned: false },
      "junk",
    ]);
    expect(parseShelf(raw).map((item) => item.label)).toEqual(["A"]);
    expect(parseShelf("{not json")).toEqual([]);
  });

  it("shows another tab's write without a reload, and builds on it", () => {
    const { result } = renderHook(() => useShelfItems());
    expect(result.current).toEqual([]);

    // Another tab writes the shelf; this tab hears only the storage event.
    act(() => {
      window.localStorage.setItem(
        SHELF_STORAGE_KEY,
        JSON.stringify([{ ...metric(7), pinned: true }]),
      );
      window.dispatchEvent(
        new StorageEvent("storage", { key: SHELF_STORAGE_KEY }),
      );
    });
    expect(result.current.map((item) => item.label)).toEqual(["Metric 7"]);

    // This tab's next change starts from the other tab's list.
    act(() => {
      putOnShelf(metric(8));
    });
    expect(result.current.map((item) => item.label)).toEqual([
      "Metric 8",
      "Metric 7",
    ]);
  });
});
