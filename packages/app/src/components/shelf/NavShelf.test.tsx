import { nativeQueryMock } from "@/test/native-query-fixture";
/**
 * The shelf in the nav footer, and its collapsed badge.
 *
 * - Empty: one dashed row says where to drop.
 * - Pinned items sit above recent ones; pin and × change the stored shelf.
 * - An item whose artifact is gone stays, muted, marked "no longer exists".
 * - With a page target registered, items it does not take fold into one
 *   "Not for this page" row that expands.
 * - The header collapses the shelf; the collapsed badge counts and opens a
 *   flyout on hover.
 */
import { useShellStore } from "@/lib/stores/shell-store";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { useCallback } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { server } = vi.hoisted(() => ({
  server: {
    tables: [] as unknown[],
    visualizations: [] as unknown[],
  },
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) => ({
    data: {
      listDataTables: server.tables,
      listVisualizations: server.visualizations,
      listDrafts: [],
    }[ref._path],
  })),
}));

import { CollapsedShelf, useHeldOpen } from "./CollapsedShelf";
import {
  AppDragProvider,
  useDropTarget,
  type DropVerdict,
} from "./drag-context";
import { ShelfPanel } from "./NavShelf";
import { ShelfScope, useShelf } from "./shelf-scope";
import {
  putOnShelf,
  readShelf,
  setShelfItemPinned,
  shelfStorageKey,
} from "./shelf-store";

const P1 = shelfStorageKey("p1");

function MetricsOnlyTarget() {
  const accepts = useCallback(
    (item: { kind: string }): DropVerdict =>
      item.kind === "metric"
        ? { ok: true, label: "Use metric" }
        : { ok: false, reason: "Metrics only" },
    [],
  );
  const onDrop = useCallback(() => {}, []);
  const { setNodeRef } = useDropTarget({
    id: "example",
    role: "page",
    accepts,
    onDrop,
  });
  return <div ref={setNodeRef} />;
}

function renderShelf(extra?: React.ReactNode) {
  return render(
    <AppDragProvider overlay={() => null}>
      <ShelfScope storageKey={P1}>
        {extra}
        <ShelfPanel targetId="shelf-nav" />
      </ShelfScope>
    </AppDragProvider>,
  );
}

function seed() {
  server.tables = [
    {
      id: "t1",
      fields: [],
      metrics: [{ id: "m1", name: "Sum of Sales" }],
    },
  ];
  server.visualizations = [{ id: "v1", name: "Sales by Product" }];
  putOnShelf(P1, {
    kind: "chart",
    id: "v1",
    scope: "i1",
    label: "Sales by Product",
  });
  putOnShelf(P1, {
    kind: "metric",
    id: "m1",
    scope: "t1",
    label: "Sum of Sales",
  });
}

describe("ShelfPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    server.tables = [];
    server.visualizations = [];
    useShellStore.setState({ shelfOpen: true });
  });

  it("shows a dashed drop row when empty", () => {
    renderShelf();
    expect(screen.getByText("Drop here to keep")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shelf" })).toBeTruthy();
  });

  it("lists pinned items above recent ones and pins or removes on click", () => {
    seed();
    act(() => {
      setShelfItemPinned(P1, "chart:v1", true);
    });
    renderShelf();

    const pinned = screen.getByRole("list", { name: "Pinned" });
    const recent = screen.getByRole("list", { name: "Recent" });
    expect(within(pinned).getByText("Sales by Product")).toBeTruthy();
    expect(within(recent).getByText("Sum of Sales")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shelf, 2 items" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pin Sum of Sales" }));
    expect(readShelf(P1).every((item) => item.pinned)).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Take Sum of Sales off shelf" }),
    );
    expect(readShelf(P1).map((item) => item.id)).toEqual(["v1"]);
    expect(screen.queryByText("Sum of Sales")).toBeNull();
  });

  it("keeps an item whose artifact is gone, marked and removable", () => {
    seed();
    server.visualizations = [];
    renderShelf();

    expect(screen.getByText("no longer exists")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Pin Sales by Product" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Take Sales by Product off shelf",
      }),
    );
    expect(screen.queryByText("no longer exists")).toBeNull();
  });

  it("offers a chip for dragging only while a page target can take it", async () => {
    seed();
    function renderCarrying(extra?: React.ReactNode) {
      return render(
        <AppDragProvider
          overlay={(drag) => <p data-testid="carried">{drag.item.label}</p>}
        >
          <ShelfScope storageKey={P1}>
            {extra}
            <ShelfPanel targetId="shelf-nav" />
          </ShelfScope>
        </AppDragProvider>,
      );
    }
    // jsdom has no PointerEvent: a MouseEvent carries the coordinates the
    // pointer sensor reads, and `isPrimary` is added by hand.
    function pointer(target: EventTarget, type: string, at: number) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: at,
        clientY: at,
      });
      Object.defineProperty(event, "isPrimary", { value: true });
      act(() => {
        target.dispatchEvent(event);
      });
    }
    function carry(label: string) {
      const chip = document.querySelector(`[data-shelf-item="${label}"]`)!;
      pointer(chip, "pointerdown", 0);
      pointer(document, "pointermove", 40);
      return chip;
    }

    // Only the shelf is a target, and it refuses its own items.
    const { unmount } = renderCarrying();
    const idle = carry("Sum of Sales");
    expect(idle.className).not.toContain("cursor-grab");
    expect(screen.queryByTestId("carried")).toBeNull();
    pointer(document, "pointerup", 40);
    unmount();

    renderCarrying(<MetricsOnlyTarget />);
    const live = carry("Sum of Sales");
    expect(live.className).toContain("cursor-grab");
    expect(screen.getByTestId("carried").textContent).toBe("Sum of Sales");
    pointer(document, "pointerup", 40);
    // The sensor swallows the next click for 50ms after a drag; let that
    // lapse so it cannot eat a click in the next test.
    await new Promise((resolve) => {
      setTimeout(resolve, 60);
    });
  });

  it("folds items this page cannot use into a Not for this page row", () => {
    seed();
    renderShelf(<MetricsOnlyTarget />);

    expect(screen.getByText("Sum of Sales")).toBeTruthy();
    expect(screen.queryByText("Sales by Product")).toBeNull();
    const row = screen.getByRole("button", { name: /Not for this page · 1/ });
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Sales by Product")).toBeTruthy();
  });

  it("collapses to its header", () => {
    seed();
    renderShelf();
    fireEvent.click(screen.getByRole("button", { name: "Shelf, 2 items" }));
    expect(screen.queryByText("Sum of Sales")).toBeNull();
    expect(useShellStore.getState().shelfOpen).toBe(false);
  });
});

describe("CollapsedShelf", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seed();
  });

  it("counts the shelf and opens the flyout on hover", () => {
    render(
      <AppDragProvider overlay={() => null}>
        <ShelfScope storageKey={P1}>
          <CollapsedShelf />
        </ShelfScope>
      </AppDragProvider>,
    );
    const badge = screen.getByRole("button", { name: "Shelf, 2 items" });
    expect(badge.getAttribute("aria-expanded")).toBe("false");
    fireEvent.mouseEnter(badge);
    expect(badge.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Sum of Sales")).toBeTruthy();
  });
});

describe("useHeldOpen", () => {
  it("keeps a close asked for during a drag and applies it when the drag ends", () => {
    const { result, rerender } = renderHook(({ held }) => useHeldOpen(held), {
      initialProps: { held: false },
    });
    act(() => result.current.onOpenChange(true)); // opened by hover
    rerender({ held: true }); // a chip is carried out of the flyout
    act(() => result.current.onOpenChange(false)); // the pointer left
    expect(result.current.open).toBe(true);
    rerender({ held: false }); // the chip landed
    expect(result.current.open).toBe(false);
  });

  it("drops the pending close when the popover is asked open again", () => {
    const { result, rerender } = renderHook(({ held }) => useHeldOpen(held), {
      initialProps: { held: true },
    });
    act(() => result.current.onOpenChange(false));
    act(() => result.current.onOpenChange(true)); // the pointer came back
    rerender({ held: false });
    expect(result.current.open).toBe(true);
  });
});

describe("ShelfScope", () => {
  function Count() {
    return <output data-testid="count">{useShelf().items.length}</output>;
  }

  it("shows the new scope's shelf on its first render after a switch", () => {
    window.localStorage.clear();
    const P2 = shelfStorageKey("p1", "another-account");
    putOnShelf(P1, { kind: "metric", id: "m1", scope: "t1", label: "A" });
    const seen: string[] = [];
    function Spy() {
      seen.push(String(useShelf().items.length));
      return null;
    }
    const { rerender } = render(
      <ShelfScope storageKey={P1}>
        <Spy />
        <Count />
      </ShelfScope>,
    );
    expect(screen.getByTestId("count").textContent).toBe("1");
    seen.length = 0;
    rerender(
      <ShelfScope storageKey={P2}>
        <Spy />
        <Count />
      </ShelfScope>,
    );
    expect(seen[0]).toBe("0");
    expect(screen.getByTestId("count").textContent).toBe("0");
  });
});
