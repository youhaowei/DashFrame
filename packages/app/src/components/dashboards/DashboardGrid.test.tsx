import {
  nativeMutationMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  gridProps: null as Record<string, unknown> | null,
  updateItems: vi.fn(async () => {}),
}));

// Partial-mock the WyStack client: keep `createApi` (so `api` builds real
// refs) and replace only `useMutation`. This consumer uses a single mutation
// (`api.commitBatch`), so the mock ignores the ref and always returns
// the same `mutateAsync` spy.
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useMutation: nativeMutationMock(() => ({ mutateAsync: mocks.updateItems })),
}));
vi.mock("@/data/host", () => ({
  useHostMutation: hostMutationMock(() => ({ mutateAsync: mocks.updateItems })),
}));

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
  });

  it("ignores responsive projections and batches an intentional desktop edit", () => {
    render(<DashboardGrid dashboard={dashboard} isEditable />);
    expect(mocks.gridProps?.onLayoutChange).toBeUndefined();

    act(() => {
      (mocks.gridProps?.onBreakpointChange as (breakpoint: string) => void)(
        "xs",
      );
    });
    act(() => {
      (mocks.gridProps?.onDragStop as (layout: unknown[]) => void)([
        { i: "first", x: 0, y: 0, w: 2, h: 4 },
      ]);
    });
    expect(mocks.updateItems).not.toHaveBeenCalled();

    act(() => {
      (mocks.gridProps?.onBreakpointChange as (breakpoint: string) => void)(
        "lg",
      );
    });
    act(() => {
      (mocks.gridProps?.onDragStop as (layout: unknown[]) => void)([
        { i: "first", x: 1, y: 2, w: 4, h: 4 },
        { i: "second", x: 7, y: 3, w: 4, h: 4 },
      ]);
    });

    expect(mocks.updateItems).toHaveBeenCalledWith({
      commands: [
        {
          path: "updateDashboardItemCmd",
          args: {
            dashboardId: "dashboard",
            itemId: "first",
            updates: { x: 1, y: 2, width: 4, height: 4 },
          },
        },
        {
          path: "updateDashboardItemCmd",
          args: {
            dashboardId: "dashboard",
            itemId: "second",
            updates: { x: 7, y: 3, width: 4, height: 4 },
          },
        },
      ],
    });
  });
});
