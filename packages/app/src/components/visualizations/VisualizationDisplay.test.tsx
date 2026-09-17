import {
  nativeQueryMock,
  nativeMutationMock,
  hostQueryMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
/** VisualizationDisplay saved execution and declared runtime-control coverage. */
import type { Insight, Visualization } from "@dashframe/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  formatUpdatedAgo,
  resolveDashboardRuntime,
  VisualizationDisplay,
} from "./VisualizationDisplay";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockUseInsightPagination } = vi.hoisted(() => ({
  mockUseInsightPagination: vi.fn(),
}));

vi.mock("@/hooks/useInsightPagination", () => ({
  resolveInsightSourceDataTable: (
    _insight: unknown,
    dataTables: readonly unknown[],
  ) => dataTables[0],
  useInsightPagination: (opts: unknown) => mockUseInsightPagination(opts),
}));

const { mockUseInsightView } = vi.hoisted(() => ({
  mockUseInsightView: vi.fn(),
}));

vi.mock("@/hooks/useInsightView", () => ({
  useInsightView: (insight: unknown, options: unknown) =>
    mockUseInsightView(insight, options),
}));

const { mockUseChartEngine } = vi.hoisted(() => ({
  mockUseChartEngine: vi.fn(),
}));

vi.mock("@/components/providers/ChartEngineProvider", () => ({
  useChartEngine: () => mockUseChartEngine(),
}));

const { mockUseVisualizations, mockUseInsights, mockUseDataTables } =
  vi.hoisted(() => ({
    mockUseVisualizations: vi.fn(),
    mockUseInsights: vi.fn(),
    mockUseDataTables: vi.fn(),
  }));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) => {
    if (ref._path === "listVisualizations") return mockUseVisualizations();
    if (ref._path === "listInsights") return mockUseInsights();
    if (ref._path === "listDataTables") return mockUseDataTables();
    throw new Error(`Unexpected query: ${ref._path}`);
  }),
  useMutation: nativeMutationMock(() => ({ mutateAsync: vi.fn() })),
}));
vi.mock("@/data/host", () => ({
  useHostQuery: hostQueryMock((ref: { _path: string }) => {
    if (ref._path === "listVisualizations") return mockUseVisualizations();
    if (ref._path === "listInsights") return mockUseInsights();
    if (ref._path === "listDataTables") return mockUseDataTables();
    throw new Error(`Unexpected query: ${ref._path}`);
  }),
  useHostMutation: hostMutationMock(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("@dashframe/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dashframe/engine")>()),
  resolveEncodingToResultFrame: vi.fn().mockReturnValue({}),
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

vi.mock("@wystack/ui-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@wystack/ui-react")>()),
  ErrorState: () => null,
  Spinner: () => null,
  Surface: ({ children }: { children: React.ReactNode }) => children,
  Toggle: () => <div data-testid="view-toggle" />,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search,
    children,
  }: {
    to: string;
    params: Record<string, string>;
    search: Record<string, unknown>;
    children: React.ReactNode;
  }) => (
    <a
      href={to.replace("$insightId", params.insightId ?? "")}
      data-report-id={String(search.reportId)}
    >
      {children}
    </a>
  ),
}));

vi.mock("./EngineUnavailableState", () => ({
  EngineUnavailableState: () => null,
}));

// ── Shared fixtures ──────────────────────────────────────────────────────────

const savedFilter = {
  id: "filter-status",
  field: "status",
  operator: "eq" as const,
  value: "active",
};

const savedSort = { field: "created_at", direction: "desc" as const };

const insight: Insight = {
  id: "ins-1",
  name: "Active Orders",
  source: { sourceType: "dataTable", sourceId: "t1" },
  selectedFields: [],
  metrics: [],
  joins: [],
  filters: [savedFilter],
  sorts: [savedSort],
  runtimeControls: {
    filters: [
      {
        key: "status",
        filterId: "filter-status",
        label: "Status",
        allowClear: true,
      },
    ],
    sort: { allowedFieldIds: ["field-created"], maxKeys: 1 },
    limit: { min: 1, max: 100 },
  },
  createdAt: 0,
} as unknown as Insight;

const dataTable = {
  id: "t1",
  fields: [
    {
      id: "field-created",
      name: "Created at",
      columnName: "created_at",
      tableId: "t1",
    },
  ],
} as never;

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
  mockUseVisualizations.mockReturnValue({
    data: [currentViz],
    isLoading: false,
  });
  mockUseInsights.mockReturnValue({ data: [currentInsight] });
  mockUseDataTables.mockReturnValue({ data: [dataTable] });
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
    resolvedFields: [],
    isReady: true,
    columnDisplayNames: {},
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("VisualizationDisplay — declared runtime controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
  });

  it("runs the saved canonical Insight when no dashboard overrides exist", () => {
    render(<VisualizationDisplay visualizationId="viz-1" />);

    const callOpts = mockUseInsightPagination.mock.calls[0]?.[0];
    expect(callOpts).toMatchObject({
      insight,
      showModelPreview: false,
      enabled: true,
      runtime: undefined,
    });
    expect(mockUseInsightView).toHaveBeenCalledWith(insight, {
      runtime: undefined,
    });
  });

  it("maps declared filter, sort, and limit values to one typed runtime input", () => {
    expect(
      resolveDashboardRuntime(insight, [dataTable], {
        filters: [{ ...savedFilter, value: "paused" }],
        sorts: [{ field: "created_at", direction: "asc" }],
        limit: 25,
      }),
    ).toEqual({
      runtime: {
        filters: { status: "paused" },
        sort: [{ fieldId: "field-created", direction: "asc" }],
        limit: 25,
      },
    });
  });

  it("fails closed when a dashboard filter was not author-declared", () => {
    expect(
      resolveDashboardRuntime(insight, [dataTable], {
        filters: [
          {
            id: "other-filter",
            field: "region",
            operator: "eq",
            value: "west",
          },
        ],
      }),
    ).toEqual({
      error: "This dashboard filter is not declared by the Insight.",
    });
  });

  it("varies one declared predicate by id and leaves its same-field sibling alone", () => {
    const floor = { id: "f-min", field: "qty", operator: "gte", value: 2 };
    const ceiling = { id: "f-max", field: "qty", operator: "lte", value: 9 };
    const ranged = {
      ...insight,
      filters: [floor, ceiling],
      runtimeControls: {
        filters: [{ key: "min", filterId: "f-min", label: "Min" }],
      },
    } as unknown as Insight;

    // The reader turns the floor. Only its key reaches the host, which keeps
    // the undeclared ceiling as saved.
    expect(
      resolveDashboardRuntime(ranged, [dataTable], {
        filters: [{ ...floor, value: 5 }],
      }),
    ).toEqual({ runtime: { filters: { min: 5 } } });

    // Sending the sibling along to "complete" the field is refused outright.
    expect(
      resolveDashboardRuntime(ranged, [dataTable], {
        filters: [{ ...floor, value: 5 }, ceiling],
      }),
    ).toEqual({
      error: "This dashboard filter is not declared by the Insight.",
    });
  });
});

describe("VisualizationDisplay — report tile", () => {
  beforeEach(() => {
    // jsdom has no ResizeObserver; a mounted tile measures its container.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.clearAllMocks();
    cleanup();
    setupCommonMocks();
  });

  it("keeps the workbench's row count and chart/table switch off a tile", async () => {
    const { rerender } = render(
      <VisualizationDisplay visualizationId="viz-1" />,
    );
    expect(await screen.findByTestId("view-toggle")).toBeTruthy();
    expect(screen.getByText(/rows •/)).toBeTruthy();

    rerender(
      <VisualizationDisplay visualizationId="viz-1" reportId="report-a" />,
    );
    expect(screen.queryByTestId("view-toggle")).toBeNull();
    expect(screen.queryByText(/rows •/)).toBeNull();
  });

  it("names the question a tile came from, scoped to the report", async () => {
    render(
      <VisualizationDisplay visualizationId="viz-1" reportId="report-a" />,
    );

    const source = await screen.findByRole("link", { name: insight.name });
    expect(source.getAttribute("href")).toBe(`/insights/${insight.id}`);
    expect(source.getAttribute("data-report-id")).toBe("report-a");
  });
});

describe("VisualizationDisplay — tile controls", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.clearAllMocks();
    cleanup();
    setupCommonMocks();
  });

  it("keeps an open control popover through the reload its own change causes", async () => {
    const itemContext = {
      item: {
        id: "item-1",
        controls: { status: { visibility: "visible" } },
      },
      dashboardControls: [],
      onReaderChange: vi.fn(),
    } as never;
    // Fresh props each time: the display is memoized and would skip the render.
    const tile = () => (
      <VisualizationDisplay
        visualizationId="viz-1"
        reportId="report-a"
        itemContext={{ ...(itemContext as object) } as never}
      />
    );
    const { rerender } = render(tile());
    fireEvent.click(
      await screen.findByRole("button", { name: "Chart controls" }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();

    mockUseInsightPagination.mockReturnValue({
      fetchData: vi.fn(),
      totalCount: 0,
      columns: [],
      resolvedFields: [],
      isReady: false,
      columnDisplayNames: {},
    });
    rerender(tile());
    expect(screen.getByRole("dialog")).toBeTruthy();

    mockUseChartEngine.mockReturnValue({ engineError: new Error("down") });
    rerender(tile());
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("formatUpdatedAgo", () => {
  it("reads as a relative time in the tile foot", () => {
    const now = Date.UTC(2026, 8, 15, 12, 0, 0);
    expect(formatUpdatedAgo(now - 20_000, now)).toBe("Updated just now");
    expect(formatUpdatedAgo(now - 5 * 60_000, now)).toMatch(/^Updated .*5 min/);
    expect(formatUpdatedAgo(now - 3 * 3_600_000, now)).toMatch(
      /^Updated .*3 h/,
    );
    expect(formatUpdatedAgo(now - 2 * 86_400_000, now)).toMatch(
      /^Updated .*2 days/,
    );
  });
});
