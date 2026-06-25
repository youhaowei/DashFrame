/**
 * Tests for VisualizationPreview terminal-state routing (YW-304).
 *
 * Three branch contracts:
 * (a) Loading — spinner is shown while insight or view is not yet ready.
 * (b) View-creation error — terminal/error UI is shown (not spinner) even when
 *     `isReady` is false, which previously spun forever due to guard ordering.
 * (c) Missing encoding — "Encoding missing" text is shown (not spinner) when
 *     `resolvedEncoding` has no x/y channel after the view is ready.
 *
 * F2 scope: VisualizationPreview.tsx only.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VisualizationPreview } from "./VisualizationPreview";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockUseInsightView } = vi.hoisted(() => ({
  mockUseInsightView: vi.fn(),
}));

vi.mock("@/hooks/useInsightView", () => ({
  useInsightView: () => mockUseInsightView(),
}));

const { mockUseInsight, mockUseDataTables } = vi.hoisted(() => ({
  mockUseInsight: vi.fn(),
  mockUseDataTables: vi.fn(),
}));

vi.mock("@dashframe/core", () => ({
  useInsight: () => mockUseInsight(),
  useDataTables: () => mockUseDataTables(),
}));

vi.mock("@dashframe/engine", () => ({
  resolveEncodingToSql: vi.fn().mockReturnValue({}),
}));

// Chart is a heavy dependency — stub it out so tests focus on guard logic.
vi.mock("@dashframe/visualization", () => ({
  Chart: () => <div data-testid="chart" />,
}));

// ── Shared fixture ───────────────────────────────────────────────────────────

const visualization = {
  id: "viz-1",
  name: "Test Chart",
  insightId: "ins-1",
  visualizationType: "bar",
  encoding: { x: "field:f1", y: "metric:m1" },
  createdAt: 0,
} as unknown as import("@dashframe/types").Visualization;

const insight = {
  id: "ins-1",
  name: "Test",
  baseTableId: "t1",
  selectedFields: [],
  metrics: [],
  joins: [],
  createdAt: 0,
} as unknown as import("@dashframe/types").Insight;

const dataTable = {
  id: "t1",
  name: "Test",
  dataSourceId: "ds1",
  table: "test",
  fields: [],
  metrics: [],
  createdAt: 0,
} as unknown as import("@dashframe/types").DataTable;

function setDataReady() {
  mockUseInsight.mockReturnValue({ data: insight, isLoading: false });
  mockUseDataTables.mockReturnValue({ data: [dataTable] });
}

// ── (a) Loading — spinner while insight or view not ready ────────────────────

describe("VisualizationPreview — (a) loading branch", () => {
  it("renders a spinner while insight is still loading", () => {
    mockUseInsight.mockReturnValue({ data: undefined, isLoading: true });
    mockUseDataTables.mockReturnValue({ data: [] });
    mockUseInsightView.mockReturnValue({
      viewName: null,
      isReady: false,
      error: null,
    });

    const { container } = render(
      <VisualizationPreview visualization={visualization} />,
    );

    // Spinner is rendered — no error text, no chart
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("Failed to load")).toBeNull();
    expect(screen.queryByText("Encoding missing")).toBeNull();
    expect(screen.queryByTestId("chart")).toBeNull();
  });

  it("renders a spinner when insight loaded but view is not yet ready (no error)", () => {
    setDataReady();
    mockUseInsightView.mockReturnValue({
      viewName: null,
      isReady: false,
      error: null,
    });

    const { container } = render(
      <VisualizationPreview visualization={visualization} />,
    );

    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.queryByText("Failed to load")).toBeNull();
  });
});

// ── (b) View-creation error — terminal UI, not spinner ───────────────────────

describe("VisualizationPreview — (b) view-creation error branch", () => {
  it("shows terminal error UI (not spinner) when error is set with isReady=false", () => {
    // This was the bug: isReady=false + error → loading guard fired before error
    // guard, resulting in indefinite spinner.
    setDataReady();
    mockUseInsightView.mockReturnValue({
      viewName: null,
      isReady: false,
      error: "View creation failed: loopback 500",
    });

    const { container } = render(
      <VisualizationPreview visualization={visualization} />,
    );

    // Must show terminal text, not a spinner
    expect(screen.getByText("Failed to load")).not.toBeNull();
    // No spinner SVG visible
    expect(container.querySelector("svg")).toBeNull();
  });

  it("passes fallback through when caller provides one and error occurs", () => {
    setDataReady();
    mockUseInsightView.mockReturnValue({
      viewName: null,
      isReady: false,
      error: "some error",
    });

    render(
      <VisualizationPreview
        visualization={visualization}
        fallback={<span data-testid="custom-fallback">custom</span>}
      />,
    );

    expect(screen.getByTestId("custom-fallback")).not.toBeNull();
    expect(screen.queryByText("Failed to load")).toBeNull();
  });

  it("default fallback (null) — renders inline 'Failed to load' text for error state", () => {
    setDataReady();
    mockUseInsightView.mockReturnValue({
      viewName: null,
      isReady: false,
      error: "view failed",
    });

    // No fallback prop → default null → fallback ?? <inline div> renders the inline text
    render(<VisualizationPreview visualization={visualization} />);

    expect(screen.getByText("Failed to load")).not.toBeNull();
  });
});

// ── (c) Encoding missing — distinct text, not spinner ───────────────────────

describe("VisualizationPreview — (c) encoding-missing branch", () => {
  it("shows 'Encoding missing' text (not spinner) when resolvedEncoding has no x/y", () => {
    // resolveEncodingToSql is already mocked to return {} (no x/y)
    setDataReady();
    mockUseInsightView.mockReturnValue({
      viewName: "v_ins1",
      isReady: true,
      error: null,
    });

    const vizNoEncoding = {
      ...visualization,
      encoding: {},
    } as unknown as import("@dashframe/types").Visualization;

    const { container } = render(
      <VisualizationPreview visualization={vizNoEncoding} />,
    );

    expect(screen.getByText("Encoding missing")).not.toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByTestId("chart")).toBeNull();
  });
});
