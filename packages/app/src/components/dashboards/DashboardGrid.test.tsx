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

// Partial-mock the Convex client: keep the real refs and replace only
// `useMutation`. The grid writes through the report draft provider, whose one
// mutation (`draftBatch`) is this `mutateAsync` spy.
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
import { ReportDraftProvider } from "./report-write";

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

  it("ignores responsive projections and batches an intentional desktop edit into the draft", async () => {
    render(
      <ReportDraftProvider draftId="draft-1" onDraftCreated={() => {}}>
        <DashboardGrid dashboard={dashboard} isEditable />
      </ReportDraftProvider>,
    );
    expect(mocks.gridProps?.onLayoutChange).toBeUndefined();

    act(() => {
      expect(mocks.gridProps).toBeDefined();
      (mocks.gridProps!.onBreakpointChange as (breakpoint: string) => void)(
        "xs",
      );
    });
    act(() => {
      expect(mocks.gridProps).toBeDefined();
      (mocks.gridProps!.onDragStop as (layout: unknown[]) => void)([
        { i: "first", x: 0, y: 0, w: 2, h: 4 },
      ]);
    });
    expect(mocks.updateItems).not.toHaveBeenCalled();

    act(() => {
      expect(mocks.gridProps).toBeDefined();
      (mocks.gridProps!.onBreakpointChange as (breakpoint: string) => void)(
        "lg",
      );
    });
    act(() => {
      expect(mocks.gridProps).toBeDefined();
      (mocks.gridProps!.onDragStop as (layout: unknown[]) => void)([
        { i: "first", x: 1, y: 2, w: 4, h: 4 },
        { i: "second", x: 7, y: 3, w: 4, h: 4 },
      ]);
    });

    await vi.waitFor(() => expect(mocks.updateItems).toHaveBeenCalled());
    // Only the desktop edit wrote; the responsive projection did not.
    expect(mocks.updateItems).toHaveBeenCalledTimes(1);
    expect(mocks.updateItems).toHaveBeenCalledWith({
      draftId: "draft-1",
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
