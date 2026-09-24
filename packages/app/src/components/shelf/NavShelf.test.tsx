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
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

import { CollapsedShelf } from "./CollapsedShelf";
import {
  AppDragProvider,
  useDropTarget,
  type DropVerdict,
} from "./drag-context";
import { ShelfPanel } from "./NavShelf";
import { putOnShelf, readShelf, setShelfItemPinned } from "./shelf-store";

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
      {extra}
      <ShelfPanel targetId="shelf-nav" />
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
  putOnShelf({
    kind: "chart",
    id: "v1",
    scope: "i1",
    label: "Sales by Product",
  });
  putOnShelf({ kind: "metric", id: "m1", scope: "t1", label: "Sum of Sales" });
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
      setShelfItemPinned("chart:v1", true);
    });
    renderShelf();

    const pinned = screen.getByRole("list", { name: "Pinned" });
    const recent = screen.getByRole("list", { name: "Recent" });
    expect(within(pinned).getByText("Sales by Product")).toBeTruthy();
    expect(within(recent).getByText("Sum of Sales")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shelf, 2 items" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pin Sum of Sales" }));
    expect(readShelf().every((item) => item.pinned)).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Take Sum of Sales off the shelf" }),
    );
    expect(readShelf().map((item) => item.id)).toEqual(["v1"]);
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
        name: "Take Sales by Product off the shelf",
      }),
    );
    expect(screen.queryByText("no longer exists")).toBeNull();
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
        <CollapsedShelf />
      </AppDragProvider>,
    );
    const badge = screen.getByRole("button", { name: "Shelf, 2 items" });
    expect(badge.getAttribute("aria-expanded")).toBe("false");
    fireEvent.mouseEnter(badge);
    expect(badge.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Sum of Sales")).toBeTruthy();
  });
});
