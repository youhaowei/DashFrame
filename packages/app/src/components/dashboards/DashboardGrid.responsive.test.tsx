import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      width: 2,
      height: 4,
    },
  ],
};

describe("DashboardGrid editing availability", () => {
  beforeEach(() => {
    mocks.currentWidth = 1280;
    mocks.onEditingAvailabilityChange.mockClear();
    mocks.updateItems.mockClear();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, mocks.currentWidth, 0),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a first measurement matching WidthProvider's seed", () => {
    render(
      <DashboardGrid
        dashboard={dashboard}
        isEditable={false}
        onEditingAvailabilityChange={mocks.onEditingAvailabilityChange}
      />,
    );

    expect(mocks.onEditingAvailabilityChange).toHaveBeenCalledOnce();
    expect(mocks.onEditingAvailabilityChange).toHaveBeenLastCalledWith(true);
  });

  it("tracks same-breakpoint width changes after the first measurement", () => {
    const view = render(
      <DashboardGrid
        dashboard={dashboard}
        isEditable={false}
        onEditingAvailabilityChange={mocks.onEditingAvailabilityChange}
      />,
    );
    expect(mocks.onEditingAvailabilityChange).toHaveBeenLastCalledWith(true);
    expect(mocks.onEditingAvailabilityChange).toHaveBeenCalledTimes(1);

    mocks.currentWidth = 1000;
    view.rerender(
      <DashboardGrid
        dashboard={dashboard}
        isEditable={false}
        onEditingAvailabilityChange={mocks.onEditingAvailabilityChange}
      />,
    );
    expect(mocks.onEditingAvailabilityChange).toHaveBeenLastCalledWith(true);
    expect(mocks.onEditingAvailabilityChange).toHaveBeenCalledTimes(2);

    mocks.currentWidth = 960;
    view.rerender(
      <DashboardGrid
        dashboard={dashboard}
        isEditable={false}
        onEditingAvailabilityChange={mocks.onEditingAvailabilityChange}
      />,
    );
    expect(mocks.onEditingAvailabilityChange).toHaveBeenLastCalledWith(false);

    mocks.currentWidth = 961;
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

  it.each([601, 481, 321])(
    "projects a stored width-2 item to the full non-lg grid span at %ipx",
    (width) => {
      mocks.currentWidth = width;

      const { container } = render(
        <DashboardGrid dashboard={dashboard} isEditable={false} />,
      );

      const gridItem = container.querySelector<HTMLElement>(".react-grid-item");
      expect(gridItem).not.toBeNull();
      // Full column span inside RGL's 16px horizontal container padding.
      expect(Number.parseFloat(gridItem?.style.width ?? "")).toBeCloseTo(
        width - 32,
      );
      expect(gridItem?.style.transform).toContain("translate(16px");

      // Keep the real DashboardItem -> MarkdownWidget path in this suite so
      // the full-width projection cannot pass while its content seam overflows.
      const markdownContent = gridItem?.querySelector<HTMLElement>(".prose");
      expect(markdownContent?.textContent).toContain("First");
      expect(markdownContent?.classList.contains("max-w-none")).toBe(true);
      expect(markdownContent?.classList.contains("overflow-auto")).toBe(true);
      expect(
        markdownContent
          ?.closest("[data-slot='surface']")
          ?.classList.contains("overflow-hidden"),
      ).toBe(true);
    },
  );

  it("stacks a reversed stored row in desktop reading order", () => {
    mocks.currentWidth = 601;
    const reversedDashboard = {
      ...dashboard,
      items: [
        {
          ...dashboard.items[0],
          id: "right",
          content: "Right widget",
          x: 6,
        },
        {
          ...dashboard.items[0],
          id: "left",
          content: "Left widget",
          x: 0,
        },
      ],
    };

    render(<DashboardGrid dashboard={reversedDashboard} isEditable={false} />);

    const leftItem = screen
      .getByText("Left widget")
      .closest<HTMLElement>(".react-grid-item");
    const rightItem = screen
      .getByText("Right widget")
      .closest<HTMLElement>(".react-grid-item");
    expect(leftItem).not.toBeNull();
    expect(rightItem).not.toBeNull();

    const verticalOffset = (item: HTMLElement | null) => {
      const match = item?.style.transform.match(
        /translate\([^,]+,\s*(-?[\d.]+)px\)/,
      );
      return Number(match?.[1]);
    };
    expect(verticalOffset(leftItem)).toBeLessThan(verticalOffset(rightItem));
  });
});
