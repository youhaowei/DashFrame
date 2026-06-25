/**
 * Tests for VisualizationDisplay — saved-insight-params forwarded to pagination
 * when no cell overrides are present.
 *
 * Contract: when `overrides` is absent, `useInsightPagination` must receive
 * effectiveParams that carry the insight's own filters/sorts so the table
 * row count reflects the saved insight configuration.
 *
 * Scope: VisualizationDisplay.tsx only (pagination effectiveParams invariant).
 */
import type { Insight, Visualization } from "@dashframe/types";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VisualizationDisplay } from "./VisualizationDisplay";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockUseInsightPagination } = vi.hoisted(() => ({
  mockUseInsightPagination: vi.fn(),
}));

vi.mock("@/hooks/useInsightPagination", () => ({
  useInsightPagination: (opts: unknown) => mockUseInsightPagination(opts),
}));

const { mockUseInsightView } = vi.hoisted(() => ({
  mockUseInsightView: vi.fn(),
}));

vi.mock("@/hooks/useInsightView", () => ({
  useInsightView: () => mockUseInsightView(),
}));

const { mockUseChartEngine } = vi.hoisted(() => ({
  mockUseChartEngine: vi.fn(),
}));

vi.mock("@/components/providers/ChartEngineProvider", () => ({
  useChartEngine: () => mockUseChartEngine(),
}));

const { mockUseDuckDBContext } = vi.hoisted(() => ({
  mockUseDuckDBContext: vi.fn(),
}));

vi.mock("@/components/providers/DuckDBProvider", () => ({
  useDuckDBContext: () => mockUseDuckDBContext(),
}));

const { mockUseVisualizations, mockUseInsights, mockUseDataTables } =
  vi.hoisted(() => ({
    mockUseVisualizations: vi.fn(),
    mockUseInsights: vi.fn(),
    mockUseDataTables: vi.fn(),
  }));

vi.mock("@dashframe/core", () => ({
  useVisualizations: () => mockUseVisualizations(),
  useInsights: () => mockUseInsights(),
  useDataTables: () => mockUseDataTables(),
}));

vi.mock("@dashframe/engine", () => ({
  resolveEffectiveParams: vi.fn((filters, sorts, _limit, overrides) => ({
    filters: overrides?.filters ?? filters ?? [],
    sorts: overrides?.sorts ?? sorts ?? [],
    limit: overrides?.limit,
  })),
  resolveEncodingToSql: vi.fn().mockReturnValue({}),
  getMetricDisplayLabel: vi.fn().mockReturnValue(""),
}));

vi.mock("@dashframe/types", () => ({
  parseEncoding: vi.fn().mockReturnValue(null),
}));

vi.mock("@dashframe/ui", () => ({
  VirtualTable: () => null,
}));

vi.mock("@dashframe/visualization", () => ({
  Chart: () => null,
  VisualizationProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useVisualization: vi.fn().mockReturnValue({ error: null }),
}));

vi.mock("@wystack/ui", () => ({
  ErrorState: () => null,
  Spinner: () => null,
  Surface: ({ children }: { children: React.ReactNode }) => children,
  Toggle: () => null,
}));

vi.mock("@wystack/ui-icons", () => ({
  ChartIcon: () => null,
  LayersIcon: () => null,
  TableIcon: () => null,
}));

vi.mock("./EngineUnavailableState", () => ({
  EngineUnavailableState: () => null,
}));

// ── Shared fixtures ──────────────────────────────────────────────────────────

const savedFilter = {
  field: "status",
  operator: "eq" as const,
  value: "active",
};

const savedSort = { field: "created_at", direction: "desc" as const };

const insight: Insight = {
  id: "ins-1",
  name: "Active Orders",
  baseTableId: "t1",
  selectedFields: [],
  metrics: [],
  joins: [],
  filters: [savedFilter],
  sorts: [savedSort],
  createdAt: 0,
} as unknown as Insight;

const viz: Visualization = {
  id: "viz-1",
  name: "Orders Chart",
  insightId: "ins-1",
  visualizationType: "bar",
  encoding: {},
  createdAt: 0,
} as unknown as Visualization;

function setupCommonMocks(currentInsight = insight, currentViz = viz) {
  mockUseChartEngine.mockReturnValue({ engineError: null });
  mockUseDuckDBContext.mockReturnValue({ db: null, connection: null });
  mockUseVisualizations.mockReturnValue({
    data: [currentViz],
    isLoading: false,
  });
  mockUseInsights.mockReturnValue({ data: [currentInsight] });
  mockUseDataTables.mockReturnValue({ data: [] });
  mockUseInsightView.mockReturnValue({
    viewName: "v_ins1",
    isReady: true,
    error: null,
    nativeCapable: true,
  });
  mockUseInsightPagination.mockReturnValue({
    fetchData: vi.fn(),
    totalCount: 5,
    columns: [],
    isReady: true,
    columnDisplayNames: {},
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("VisualizationDisplay — saved params forwarded when overrides absent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
  });

  it("forwards the insight's saved filters to useInsightPagination via effectiveParams when no overrides prop", () => {
    render(<VisualizationDisplay visualizationId="viz-1" />);

    // useInsightPagination must have been called
    expect(mockUseInsightPagination).toHaveBeenCalled();

    const callOpts = mockUseInsightPagination.mock.calls[0]?.[0];
    // effectiveParams must be present and carry the saved filter
    expect(callOpts).toBeDefined();
    expect(callOpts.effectiveParams).toBeDefined();
    expect(callOpts.effectiveParams.filters).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "status" })]),
    );
  });

  it("forwards the insight's saved sorts to useInsightPagination via effectiveParams when no overrides prop", () => {
    render(<VisualizationDisplay visualizationId="viz-1" />);

    const callOpts = mockUseInsightPagination.mock.calls[0]?.[0];
    expect(callOpts?.effectiveParams?.sorts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "created_at" }),
      ]),
    );
  });

  it("effectiveParams carries empty arrays (not undefined) when insight has no filters/sorts", () => {
    // An insight with no filters/sorts should still produce effectiveParams
    // with empty arrays — so buildInsightSQL doesn't fall through to a
    // missing-param branch.
    const bareInsight: Insight = {
      ...insight,
      id: "ins-bare",
      filters: undefined,
      sorts: undefined,
    };
    const bareViz: Visualization = {
      ...viz,
      id: "viz-bare",
      insightId: "ins-bare",
    };
    setupCommonMocks(bareInsight, bareViz);

    render(<VisualizationDisplay visualizationId="viz-bare" />);

    const callOpts = mockUseInsightPagination.mock.calls[0]?.[0];
    expect(callOpts?.effectiveParams).toBeDefined();
    expect(Array.isArray(callOpts?.effectiveParams?.filters)).toBe(true);
    expect(Array.isArray(callOpts?.effectiveParams?.sorts)).toBe(true);
  });

  it("when overrides are present, paginationEffectiveParams merges them into effectiveParams for pagination", () => {
    // Regression: paginationEffectiveParams is always computed from resolveEffectiveParams
    // with overrides forwarded — this path verifies the override is merged (not lost).
    const overrideFilter = {
      field: "region",
      operator: "eq" as const,
      value: "west",
    };
    const overrides = { filters: [overrideFilter] };

    render(
      <VisualizationDisplay
        visualizationId="viz-1"
        overrides={overrides as never}
      />,
    );

    const callOpts = mockUseInsightPagination.mock.calls[0]?.[0];
    // The override filter should reach useInsightPagination (mock merges overrides.filters ?? insight.filters)
    expect(callOpts?.effectiveParams?.filters).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "region" })]),
    );
  });
});
