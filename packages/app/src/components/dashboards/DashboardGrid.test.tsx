import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gridProps: null as Record<string, unknown> | null,
  updateItems: vi.fn(async () => {}),
  onEditingAvailabilityChange: vi.fn(),
}));

// Partial-mock the WyStack client: keep `createApi` (so `api` builds real
// refs) and replace only `useMutation`. This consumer uses a single mutation
// (`api.updateDashboardItems`), so the mock ignores the ref and always returns
// the same `mutateAsync` spy.
vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useMutation: () => ({ mutateAsync: mocks.updateItems }),
  };
});

vi.mock("react-grid-layout", () => ({
  WidthProvider: (Grid: unknown) => Grid,
  Responsive: (props: Record<string, unknown>) => {
    mocks.gridProps = props;
    return <div>{props.children as React.ReactNode}</div>;
  },
}));

vi.mock("./DashboardItem", () => ({
  DashboardItem: () => <div>item</div>,
}));

import { DashboardGrid } from "./DashboardGrid";

const dashboard = {
  id: "dashboard",
  name: "Dashboard",
  createdAt: 0,
  items: [
    {
      id: "first",
      type: "markdown" as const,
      content: "First",
      x: 0,
      y: 0,
      width: 4,
      height: 4,
    },
    {
      id: "second",
      type: "markdown" as const,
      content: "Second",
      x: 4,
      y: 0,
      width: 4,
      height: 4,
    },
  ],
};

describe("DashboardGrid canonical layout persistence", () => {
  beforeEach(() => {
    mocks.gridProps = null;
    mocks.updateItems.mockClear();
    mocks.onEditingAvailabilityChange.mockClear();
  });

  it("ignores responsive projections and batches an intentional desktop edit", () => {
    render(
      <DashboardGrid
        dashboard={dashboard}
        isEditable
        onEditingAvailabilityChange={mocks.onEditingAvailabilityChange}
      />,
    );
    expect(mocks.gridProps?.onLayoutChange).toBeUndefined();
    expect(mocks.gridProps?.layouts).toMatchObject({
      lg: [
        { i: "first", x: 0, w: 4 },
        { i: "second", x: 4, w: 4 },
      ],
      md: [
        { i: "first", x: 0, w: 10 },
        { i: "second", x: 0, w: 10 },
      ],
      sm: [
        { i: "first", x: 0, w: 6 },
        { i: "second", x: 0, w: 6 },
      ],
      xs: [
        { i: "first", x: 0, w: 4 },
        { i: "second", x: 0, w: 4 },
      ],
      xxs: [
        { i: "first", x: 0, w: 2 },
        { i: "second", x: 0, w: 2 },
      ],
    });

    act(() => {
      (mocks.gridProps?.onWidthChange as (width: number) => void)(800);
    });
    expect(mocks.gridProps?.isDraggable).toBe(false);
    expect(mocks.gridProps?.isResizable).toBe(false);
    expect(mocks.onEditingAvailabilityChange).toHaveBeenLastCalledWith(false);
    act(() => {
      (mocks.gridProps?.onDragStop as (layout: unknown[]) => void)([
        { i: "first", x: 0, y: 0, w: 2, h: 4 },
      ]);
    });
    expect(mocks.updateItems).not.toHaveBeenCalled();

    act(() => {
      (mocks.gridProps?.onWidthChange as (width: number) => void)(1000);
    });
    expect(mocks.gridProps?.isDraggable).toBe(true);
    expect(mocks.gridProps?.isResizable).toBe(true);
    expect(mocks.onEditingAvailabilityChange).toHaveBeenLastCalledWith(true);
    act(() => {
      (mocks.gridProps?.onDragStop as (layout: unknown[]) => void)([
        { i: "first", x: 1, y: 2, w: 4, h: 4 },
        { i: "second", x: 7, y: 3, w: 4, h: 4 },
      ]);
    });

    expect(mocks.updateItems).toHaveBeenCalledWith({
      dashboardId: "dashboard",
      patches: [
        { itemId: "first", updates: { x: 1, y: 2, width: 4, height: 4 } },
        { itemId: "second", updates: { x: 7, y: 3, width: 4, height: 4 } },
      ],
    });
  });
});
