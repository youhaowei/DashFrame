import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentWidth: 1280,
  onEditingAvailabilityChange: vi.fn(),
  updateItems: vi.fn(async () => {}),
}));

vi.mock("@wystack/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wystack/client")>();
  return {
    ...actual,
    useMutation: () => ({ mutateAsync: mocks.updateItems }),
  };
});

// Exercise Responsive from the installed library. Only replace WidthProvider
// so the test can deterministically drive the container width RGL receives.
vi.mock("react-grid-layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-grid-layout")>();
  return {
    ...actual,
    WidthProvider:
      (Grid: ComponentType<Record<string, unknown>>) =>
      (props: Record<string, unknown>) => (
        <Grid {...props} width={mocks.currentWidth} />
      ),
  };
});

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
  ],
};

describe("DashboardGrid editing availability", () => {
  beforeEach(() => {
    mocks.currentWidth = 1280;
    mocks.onEditingAvailabilityChange.mockClear();
    mocks.updateItems.mockClear();
  });

  it("tracks same-breakpoint width changes from a wide initial render", () => {
    const view = render(
      <DashboardGrid
        dashboard={dashboard}
        isEditable={false}
        onEditingAvailabilityChange={mocks.onEditingAvailabilityChange}
      />,
    );
    expect(mocks.onEditingAvailabilityChange).toHaveBeenLastCalledWith(true);

    mocks.currentWidth = 1000;
    view.rerender(
      <DashboardGrid
        dashboard={dashboard}
        isEditable={false}
        onEditingAvailabilityChange={mocks.onEditingAvailabilityChange}
      />,
    );
    expect(mocks.onEditingAvailabilityChange).toHaveBeenLastCalledWith(true);

    mocks.currentWidth = 800;
    view.rerender(
      <DashboardGrid
        dashboard={dashboard}
        isEditable={false}
        onEditingAvailabilityChange={mocks.onEditingAvailabilityChange}
      />,
    );
    expect(mocks.onEditingAvailabilityChange).toHaveBeenLastCalledWith(false);

    mocks.currentWidth = 1000;
    view.rerender(
      <DashboardGrid
        dashboard={dashboard}
        isEditable={false}
        onEditingAvailabilityChange={mocks.onEditingAvailabilityChange}
      />,
    );
    expect(mocks.onEditingAvailabilityChange).toHaveBeenLastCalledWith(true);
  });
});
