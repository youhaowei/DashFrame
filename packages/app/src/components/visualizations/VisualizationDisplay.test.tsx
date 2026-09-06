import {
  nativeQueryMock,
  nativeMutationMock,
  hostQueryMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
/** VisualizationDisplay saved execution and declared runtime-control coverage. */
import type { Insight, Visualization } from "@dashframe/types";
import { render } from "@testing-library/react";
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

vi.mock("@dashframe/engine", () => ({
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

vi.mock("@wystack/ui-react", () => ({
  ErrorState: () => null,
  Spinner: () => null,
  Surface: ({ children }: { children: React.ReactNode }) => children,
  Toggle: () => null,
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
});
