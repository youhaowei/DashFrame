import { act, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addItem: vi.fn(async () => {}),
  dashboard: {
    id: "dashboard",
    name: "Dashboard",
    createdAt: 0,
    items: [],
    controls: [],
  },
  editingAvailabilityCallback: undefined as
    | ((isAvailable: boolean) => void)
    | undefined,
  gridAvailabilityOnMount: null as boolean | null,
  isFetching: false,
  navigate: vi.fn(),
}));

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: (ref: { _path: string }) => ({
      data: ref._path === "listDashboards" ? [mocks.dashboard] : [],
      isFetching: mocks.isFetching,
      isLoading: false,
    }),
    useMutation: () => ({ mutateAsync: mocks.addItem }),
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/components/assistant/artifact-context", () => ({
  useBindArtifact: () => {},
}));

vi.mock("@/components/dashboards/DashboardGrid", () => ({
  DashboardGrid: (props: {
    onEditingAvailabilityChange?: (isAvailable: boolean) => void;
  }) => {
    const { onEditingAvailabilityChange } = props;
    mocks.editingAvailabilityCallback = onEditingAvailabilityChange;
    useLayoutEffect(() => {
      if (mocks.gridAvailabilityOnMount !== null) {
        onEditingAvailabilityChange?.(mocks.gridAvailabilityOnMount);
      }
      return () => {
        mocks.editingAvailabilityCallback = undefined;
      };
    }, [onEditingAvailabilityChange]);
    return <div>grid</div>;
  },
}));

import DashboardDetailContent from "./DashboardDetailContent";

describe("DashboardDetailContent editing availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.editingAvailabilityCallback = undefined;
    mocks.gridAvailabilityOnMount = null;
    mocks.isFetching = false;
    mocks.dashboard.name = "Dashboard";
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
  });

  it("keeps editing unavailable until the grid reports its first measurement", () => {
    render(<DashboardDetailContent dashboardId="dashboard" />);

    expect(
      screen
        .getByRole("button", { name: "Edit Dashboard" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.queryByText("Editing unavailable: dashboard needs a wider area.", {
        exact: true,
      }),
    ).toBeNull();

    act(() => {
      mocks.editingAvailabilityCallback?.(true);
    });

    expect(
      screen
        .getByRole("button", { name: "Edit Dashboard" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("closes an open add-widget dialog when editing becomes unavailable", () => {
    render(<DashboardDetailContent dashboardId="dashboard" />);

    act(() => {
      mocks.editingAvailabilityCallback?.(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit Dashboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Widget" }));
    expect(screen.getByRole("dialog", { name: "Add Widget" })).toBeTruthy();

    act(() => {
      mocks.editingAvailabilityCallback?.(false);
    });

    expect(screen.queryByRole("dialog", { name: "Add Widget" })).toBeNull();
    expect(
      screen.getByText("Editing unavailable: dashboard needs a wider area.", {
        exact: true,
      }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Edit Dashboard" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(mocks.addItem).not.toHaveBeenCalled();
  });

  it("fails closed across a refetch and narrow grid remount", () => {
    mocks.gridAvailabilityOnMount = true;
    const view = render(<DashboardDetailContent dashboardId="dashboard" />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Dashboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Widget" }));
    expect(screen.getByRole("dialog", { name: "Add Widget" })).toBeTruthy();

    mocks.isFetching = true;
    mocks.gridAvailabilityOnMount = null;
    view.rerender(<DashboardDetailContent dashboardId="dashboard" />);

    expect(screen.getByText("Loading dashboard...")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Add Widget" })).toBeNull();

    mocks.isFetching = false;
    view.rerender(<DashboardDetailContent dashboardId="dashboard" />);

    expect(screen.queryByRole("button", { name: "Done Editing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Widget" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Edit Dashboard" })
        .hasAttribute("disabled"),
    ).toBe(true);

    act(() => {
      mocks.editingAvailabilityCallback?.(false);
    });

    expect(
      screen.getByText("Editing unavailable: dashboard needs a wider area.", {
        exact: true,
      }),
    ).toBeTruthy();
    expect(mocks.addItem).not.toHaveBeenCalled();
  });

  it("lets a long unbroken dashboard name shrink inside a 320px header", () => {
    mocks.dashboard.name = "W".repeat(80);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 320,
    });

    render(<DashboardDetailContent dashboardId="dashboard" />);

    const heading = screen.getByRole("heading", { name: mocks.dashboard.name });
    const titleRegion = heading.parentElement;
    const leadingRegion = titleRegion?.parentElement;
    const header = heading.closest<HTMLElement>(".dashboard-detail-header");
    expect(header?.classList.contains("flex-wrap")).toBe(true);
    expect(header?.classList.contains("min-w-0")).toBe(true);
    expect(leadingRegion?.classList.contains("min-w-0")).toBe(true);
    expect(titleRegion?.classList.contains("min-w-0")).toBe(true);
    expect(heading.classList.contains("break-words")).toBe(true);
    expect(heading.classList.contains("[overflow-wrap:anywhere]")).toBe(true);
    expect(
      header?.contains(screen.getByRole("button", { name: "Edit Dashboard" })),
    ).toBe(true);
  });
});
