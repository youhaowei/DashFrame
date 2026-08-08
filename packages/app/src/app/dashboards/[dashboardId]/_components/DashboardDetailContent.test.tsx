import { act, fireEvent, render, screen } from "@testing-library/react";
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
  navigate: vi.fn(),
}));

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useQuery: (ref: { _path: string }) => ({
      data: ref._path === "listDashboards" ? [mocks.dashboard] : [],
      isFetching: false,
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
    mocks.editingAvailabilityCallback = props.onEditingAvailabilityChange;
    return <div>grid</div>;
  },
}));

import DashboardDetailContent from "./DashboardDetailContent";

describe("DashboardDetailContent editing availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.editingAvailabilityCallback = undefined;
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
});
