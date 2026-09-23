import {
  nativeQueryMock,
  nativeMutationMock,
  hostQueryMock,
  hostMutationMock,
} from "@/test/native-query-fixture";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockNavigate, mockCommitBatch, mockToastError, renderedState } =
  vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    mockCommitBatch: vi.fn(),
    mockToastError: vi.fn(),
    renderedState: {
      current: {
        isReady: false,
        error: null as string | null,
        schema: [] as { id: string; name: string; type: string }[],
        sampleRows: [] as Record<string, unknown>[],
        totalCount: 0,
      },
    },
  }));

vi.mock("@/components/layouts/AppLayout", () => ({
  AppLayout: ({
    children,
    headerContent,
  }: {
    children?: React.ReactNode;
    headerContent?: React.ReactNode;
  }) => (
    <>
      {headerContent}
      {children}
    </>
  ),
}));
vi.mock("@/components/shell/context-panel-outlet", () => ({
  useContextPanelSection: () => undefined,
}));
vi.mock("@/components/visualizations/AxisSelectField", () => ({
  AxisSelectField: () => null,
}));
vi.mock("@/components/visualizations/VisualizationDisplay", () => ({
  VisualizationDisplay: () => <div data-testid="viz-display" />,
}));
vi.mock("@/hooks/useInsightPagination", () => ({
  resolveInsightSourceDataTable: () => undefined,
  useInsightPagination: (options: { showModelPreview?: boolean }) =>
    options.showModelPreview
      ? {
          columns: [],
          columnDisplayNames: {},
          resolvedFields: [],
        }
      : {
          columnDisplayNames: {},
          schema: renderedState.current.schema,
          sampleRows: renderedState.current.sampleRows,
          totalCount: renderedState.current.totalCount,
          isReady: renderedState.current.isReady,
          error: renderedState.current.error,
        },
}));
vi.mock("@/lib/utils/field-icons", () => ({ getColumnIcon: vi.fn() }));
vi.mock("@/lib/visualizations/encoding-enforcer", () => ({
  getSwappedChartType: vi.fn(),
  isSwapAllowed: () => false,
  validateEncoding: () => ({}),
}));
vi.mock("@/lib/visualizations/suggest-charts", () => ({
  getAlternativeChartTypes: () => [],
}));
vi.mock("@dashframe/engine", () => ({
  extractColumnAliasComponents: vi.fn(),
  fieldIdToColumnAlias: vi.fn(),
  getMetricDisplayLabel: vi.fn(),
  isGeneratedColumnLabel: () => false,
  metricIdToColumnAlias: vi.fn(),
}));
vi.mock("@dashframe/types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dashframe/types")>();
  return {
    ...actual,
    buildVisualizationUpdateCommands: vi.fn(() => []),
    CHART_TYPE_METADATA: {},
    parseEncoding: vi.fn(() => ({})),
  };
});
vi.mock("@dashframe/ui", () => ({ SelectField: () => null }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) => {
    if (ref._path === "listVisualizations") {
      return {
        data: [
          {
            encoding: {},
            id: "viz-1",
            insightId: "insight-1",
            name: "Revenue by month",
            visualizationType: "barY",
          },
        ],
        isLoading: false,
      };
    }
    if (ref._path === "listInsights") {
      return {
        data: [
          {
            id: "insight-1",
            name: "Revenue",
            source: { sourceType: "dataTable", sourceId: "table-1" },
            selectedFields: ["field-1"],
            metrics: [],
            createdAt: 0,
          },
        ],
        isLoading: false,
      };
    }
    return { data: [], isLoading: false };
  }),
  useMutation: nativeMutationMock(() => ({ mutateAsync: mockCommitBatch })),
}));
vi.mock("@/data/host", () => ({
  useHostQuery: hostQueryMock(() => ({ data: [], isLoading: false })),
  useHostMutation: hostMutationMock(() => ({ mutateAsync: mockCommitBatch })),
}));
vi.mock("@wystack/ui-react", () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Button: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
  Card: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  CardContent: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  Input: () => null,
  Spinner: () => null,
}));
vi.mock("@wystack/ui-react/icons", () => ({
  AlertCircleIcon: () => null,
  ArrowLeftIcon: () => null,
  ArrowUpDownIcon: () => null,
  ChartIcon: () => null,
  DataPointIcon: () => null,
  DeleteIcon: () => null,
}));
vi.mock("../_hooks/useCompiledInsight", () => ({
  useCompiledInsight: () => ({ data: undefined }),
}));
vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

import VisualizationPageContent from "./VisualizationPageContent";

describe("VisualizationPageContent data states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderedState.current = {
      isReady: false,
      error: null,
      schema: [],
      sampleRows: [],
      totalCount: 0,
    };
  });

  it("shows the data-unavailable state with the host's message when the insight run fails", () => {
    renderedState.current = {
      isReady: false,
      error:
        "This insight couldn't be compiled. Its source table may not have data yet.",
      schema: [],
      sampleRows: [],
      totalCount: 0,
    };

    render(<VisualizationPageContent visualizationId="viz-1" />);

    expect(screen.getByText("Data not available")).not.toBeNull();
    expect(
      screen.getByText(
        /This insight couldn't be compiled\. Its source table may not have data yet\./,
      ),
    ).not.toBeNull();
    expect(screen.queryByText("Loading visualization...")).toBeNull();
    expect(screen.queryByTestId("viz-display")).toBeNull();
  });

  it("keeps loading while the insight run is still in flight", () => {
    renderedState.current = {
      isReady: false,
      error: null,
      schema: [],
      sampleRows: [],
      totalCount: 0,
    };

    render(<VisualizationPageContent visualizationId="viz-1" />);

    expect(screen.getByText("Loading visualization...")).not.toBeNull();
    expect(screen.queryByText("Data not available")).toBeNull();
  });

  it("renders the chart view for a legitimately empty result", () => {
    renderedState.current = {
      isReady: true,
      error: null,
      schema: [{ id: "field_1", name: "Region", type: "string" }],
      sampleRows: [],
      totalCount: 0,
    };

    render(<VisualizationPageContent visualizationId="viz-1" />);

    expect(screen.getByTestId("viz-display")).not.toBeNull();
    expect(screen.getByText("0 rows • 1 columns")).not.toBeNull();
    expect(screen.queryByText("Data not available")).toBeNull();
    expect(screen.queryByText("Loading visualization...")).toBeNull();
  });
});
