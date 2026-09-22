import {
  nativeQueryMock,
  nativeMutationMock,
  hostQueryMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
/** VisualizationDisplay saved execution and declared runtime-control coverage. */
import type { Insight, Visualization } from "@dashframe/types";
import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
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

vi.mock("./ReportSwitchers", () => ({
  ReportSwitchers: ({
    fields,
    onChange,
  }: {
    fields: Array<{ name: string }>;
    onChange: (runtime: { measures: string[] }) => void;
  }) => (
    <div aria-label="Switcher fields">
      {fields.map((field) => (
        <span key={field.name}>{field.name}</span>
      ))}
      <button type="button" onClick={() => onChange({ measures: ["revenue"] })}>
        Revenue only
      </button>
    </div>
  ),
}));

vi.mock("@dashframe/visualization", () => ({
  Chart: () => null,
  VisualizationProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useVisualization: vi.fn().mockReturnValue({ error: null }),
}));

vi.mock("@wystack/ui-react", () => ({
  ErrorState: ({
    title,
    description,
    retryAction,
  }: {
    title: string;
    description?: string;
    retryAction?: { label: string; onClick: () => void };
  }) => (
    <div role="alert">
      <span>{title}</span>
      <span>{description}</span>
      {retryAction && (
        <button type="button" onClick={retryAction.onClick}>
          {retryAction.label}
        </button>
      )}
    </div>
  ),
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

vi.mock("@wystack/ui-react/icons", () => ({
  ChartIcon: () => null,
  LayersIcon: () => null,
  TableIcon: () => null,
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
      presentation: undefined,
    });
  });

  it("offers unselected declared dimensions after reopening a saved report", async () => {
    const report = {
      ...insight,
      selectedFields: ["field-date", "field-channel"],
      runtimeControls: {
        dimensions: {
          allowedIds: ["field-date", "field-channel", "field-country"],
          maxSelected: 2,
        },
      },
    } as Insight;
    const reportTable = {
      ...dataTable,
      name: "Orders",
      dataFrameId: "orders-frame",
      fields: [
        {
          id: "field-date",
          name: "Date",
          columnName: "date",
          type: "date",
          tableId: "t1",
        },
        {
          id: "field-channel",
          name: "Channel",
          columnName: "channel",
          type: "string",
          tableId: "t1",
        },
        {
          id: "field-country",
          name: "Country",
          columnName: "country",
          type: "string",
          tableId: "t1",
        },
      ],
    };
    setupCommonMocks(report);
    mockUseDataTables.mockReturnValue({ data: [reportTable] });
    mockUseInsightPagination.mockReturnValue({
      fetchData: vi.fn(),
      totalCount: 5,
      columns: [],
      // The materialized result contains only currently selected dimensions.
      resolvedFields: reportTable.fields.slice(0, 2),
      isReady: true,
      columnDisplayNames: {},
    });

    render(<VisualizationDisplay visualizationId="viz-1" />);

    expect(await screen.findByText("Country")).toBeTruthy();
  });

  it("surfaces canonical runtime failures before requesting a chart presentation", async () => {
    const user = userEvent.setup({ delay: null });
    const retry = vi.fn();
    mockUseInsightPagination.mockImplementation(
      (options: { runtime?: { measures?: string[] } }) =>
        options.runtime?.measures
          ? {
              fetchData: vi.fn(),
              totalCount: 0,
              columns: [],
              resolvedFields: [],
              isReady: false,
              error: "Revenue could not be calculated.",
              retry,
              columnDisplayNames: {},
            }
          : {
              fetchData: vi.fn(),
              totalCount: 5,
              columns: [],
              resolvedFields: [],
              isReady: true,
              error: null,
              retry,
              columnDisplayNames: {},
            },
    );
    render(<VisualizationDisplay visualizationId="viz-1" />);
    expect(await screen.findByText("Revenue only")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Revenue only" }));

    expect(
      await screen.findByText("Revenue could not be calculated."),
    ).toBeTruthy();
    expect(mockUseInsightView).toHaveBeenLastCalledWith(null, {
      runtime: { measures: ["revenue"] },
      presentation: undefined,
    });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
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

  it("maps a shared field control and its cleared value to the declared filter", () => {
    for (const cleared of [false, true]) {
      expect(
        resolveDashboardRuntime(insight, [dataTable], {
          filters: [
            { field: "status", operator: "eq", value: "paused", cleared },
          ],
        }),
      ).toEqual({
        runtime: { filters: { status: cleared ? null : "paused" } },
      });
    }
  });

  it("maps a raw shared-control field to a declared alias-form filter", () => {
    const aliased = {
      ...insight,
      filters: [
        {
          ...savedFilter,
          field: fieldIdToColumnAlias("field-created"),
        },
      ],
    } as Insight;
    expect(
      resolveDashboardRuntime(aliased, [dataTable], {
        filters: [{ field: "created_at", operator: "eq", value: "paused" }],
      }),
    ).toEqual({ runtime: { filters: { status: "paused" } } });
  });

  it("resolves an insight-sourced synthesized field with the authoring catalog", () => {
    const metricId = "metric-revenue";
    const upstream = {
      ...insight,
      id: "upstream",
      filters: [],
      metrics: [
        {
          id: metricId,
          name: "Revenue",
          sourceTable: "t1",
          aggregation: "sum",
          columnName: "created_at",
        },
      ],
      runtimeControls: undefined,
    } as Insight;
    const derived = {
      ...insight,
      id: "derived",
      source: { sourceType: "insight", sourceId: upstream.id },
      filters: [
        {
          id: "revenue-filter",
          field: fieldIdToColumnAlias(metricId),
          operator: "eq",
          value: 100,
        },
      ],
      runtimeControls: {
        filters: [
          {
            key: "revenue",
            filterId: "revenue-filter",
            label: "Revenue",
            allowClear: true,
          },
        ],
      },
    } as Insight;

    expect(
      resolveDashboardRuntime(
        derived,
        [dataTable],
        {
          filters: [
            {
              field: metricIdToColumnAlias(metricId),
              operator: "eq",
              value: 250,
            },
          ],
        },
        [upstream, derived],
      ),
    ).toEqual({ runtime: { filters: { revenue: 250 } } });
  });

  it("rejects ambiguous shared fields and incompatible predicate operators", () => {
    const ambiguous: Insight = {
      ...insight,
      filters: [
        ...(insight.filters ?? []),
        { ...savedFilter, id: "second-status" },
      ],
      runtimeControls: {
        filters: [
          ...insight.runtimeControls!.filters!,
          { key: "second", filterId: "second-status", label: "Second status" },
        ],
      },
    };
    for (const [target, operator] of [
      [ambiguous, "eq"],
      [insight, "ne"],
    ] as const) {
      expect(
        resolveDashboardRuntime(target, [dataTable], {
          filters: [{ field: "status", operator, value: "paused" }],
        }),
      ).toEqual({
        error: "This dashboard filter is not declared by the Insight.",
      });
    }
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
});

describe("VisualizationDisplay — report tile", () => {
  beforeEach(() => {
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

  it("says a tile's saved view was deleted instead of loading forever", async () => {
    mockUseVisualizations.mockReturnValue({ data: [], isLoading: false });
    render(
      <VisualizationDisplay visualizationId="viz-1" reportId="report-a" />,
    );

    expect(await screen.findByText(/saved view was deleted/)).toBeTruthy();
    expect(screen.queryByText("Loading visualization...")).toBeNull();
  });
});
