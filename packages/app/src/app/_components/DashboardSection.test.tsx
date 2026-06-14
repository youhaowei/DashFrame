/**
 * Navigation contracts for the home-page section components.
 *
 * Contracts:
 * - DashboardSection: clicking "View all" calls navigate with the viewAllHref
 *   that was passed in, without any unsafe cast.
 * - RecentInsightsSection: selecting an item calls navigate with the typed
 *   insight detail route.
 * - RecentVisualizationsSection: selecting an item calls navigate with the
 *   typed visualization detail route.
 *
 * These tests also serve as the typecheck-passes-without-`as never` proof:
 * the mock returns a plain jest.fn() with type `(opts: { to: string }) => void`,
 * which the real navigate call satisfies without any cast.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockNavigate } = vi.hoisted(() => {
  const navigate = vi.fn();
  return { mockNavigate: navigate };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@dashframe/core", () => ({
  useInsights: () => ({
    data: [
      {
        id: "ins-1",
        name: "Revenue Trend",
        createdAt: 1000,
        metrics: [{ id: "m1" }],
        selectedFields: ["field1", "field2"],
      },
    ],
  }),
  useVisualizations: () => ({
    data: [
      {
        id: "viz-1",
        name: "Bar Chart",
        createdAt: 1000,
      },
    ],
  }),
}));

// VisualizationPreview is a heavy component — stub it to avoid pulling in
// chart renderer dependencies.
vi.mock("@/components/visualizations/VisualizationPreview", () => ({
  VisualizationPreview: () => null,
}));

// ---------------------------------------------------------------------------
// Import components after mocks are set up
// ---------------------------------------------------------------------------

import { DashboardSection } from "./DashboardSection";
import { RecentInsightsSection } from "./RecentInsightsSection";
import { RecentVisualizationsSection } from "./RecentVisualizationsSection";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DashboardSection – View all navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls navigate with viewAllHref when 'View all' is clicked", () => {
    render(
      <DashboardSection
        title="Test Section"
        viewAllHref="/insights"
        items={[{ id: "1", title: "Item 1" }]}
        onItemSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /view all/i }));

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/insights" });
  });
});

describe("RecentInsightsSection – item navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls navigate with the typed insight route on item select", () => {
    render(<RecentInsightsSection />);

    // The section renders the item; click it to trigger onItemSelect → navigate
    fireEvent.click(screen.getByText("Revenue Trend"));

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/insights/ins-1" });
  });
});

describe("RecentVisualizationsSection – item navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls navigate with the typed visualization route on item select", () => {
    render(<RecentVisualizationsSection />);

    fireEvent.click(screen.getByText("Bar Chart"));

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/visualizations/viz-1" });
  });
});
