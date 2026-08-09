import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockNavigate, mockRemoveVisualization, mockToastError } = vi.hoisted(
  () => ({
    mockNavigate: vi.fn(),
    mockRemoveVisualization: vi.fn(),
    mockToastError: vi.fn(),
  }),
);

vi.mock("@/components/assistant/artifact-context", () => ({
  useBindArtifact: () => undefined,
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
vi.mock("@/components/providers/DuckDBProvider", () => ({
  useDuckDB: () => ({
    connection: null,
    isInitialized: false,
    isLoading: false,
  }),
}));
vi.mock("@/components/shell/context-panel-outlet", () => ({
  useContextPanelSection: () => undefined,
}));
vi.mock("@/components/visualizations/AxisSelectField", () => ({
  AxisSelectField: () => null,
}));
vi.mock("@/components/visualizations/VisualizationDisplay", () => ({
  VisualizationDisplay: () => null,
}));
vi.mock("@/hooks/useDataFrameData", () => ({
  useDataFrameData: () => ({
    data: { columns: [], rows: [] },
    entry: { columnCount: 0, rowCount: 0 },
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useInsightPagination", () => ({
  useInsightPagination: () => ({
    columnDisplayNames: {},
    columns: [],
    resolvedFields: [],
  }),
}));
vi.mock("@/hooks/useInsightView", () => ({
  useInsightView: () => ({ isReady: false, viewName: null }),
}));
vi.mock("@/lib/data-access/data-frames", () => ({
  getDataFrame: vi.fn(),
}));
vi.mock("@/lib/insights/compute-preview", () => ({
  computeInsightPreview: vi.fn(),
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
vi.mock("@/wystack/api", () => ({
  api: {
    commitBatch: { _path: "commitBatch" },
    listDataTables: { _path: "listDataTables" },
    listInsights: { _path: "listInsights" },
    listVisualizations: { _path: "listVisualizations" },
    removeVisualization: { _path: "removeVisualization" },
  },
}));
vi.mock("@dashframe/engine", () => ({
  extractColumnAliasComponents: vi.fn(),
  fieldIdToColumnAlias: vi.fn(),
  getMetricDisplayLabel: vi.fn(),
  isGeneratedColumnLabel: () => false,
  metricIdToColumnAlias: vi.fn(),
}));
vi.mock("@dashframe/engine-browser", () => ({ analyzeView: vi.fn() }));
vi.mock("@dashframe/types", () => ({
  buildVisualizationUpdateCommands: vi.fn(() => []),
  CHART_TYPE_METADATA: {},
  parseEncoding: vi.fn(() => ({})),
}));
vi.mock("@dashframe/ui", () => ({ SelectField: () => null }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));
vi.mock("@wystack/client", () => ({
  useMutation: (ref: { _path: string }) => ({
    mutateAsync:
      ref._path === "removeVisualization" ? mockRemoveVisualization : vi.fn(),
  }),
  useQuery: (ref: { _path: string }) => {
    if (ref._path === "listVisualizations") {
      return {
        data: [
          {
            encoding: {},
            id: "viz-1",
            name: "Revenue by month",
            visualizationType: "barY",
          },
        ],
        isLoading: false,
      };
    }
    return { data: [], isLoading: false };
  },
}));
vi.mock("@wystack/ui-react", () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Button: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button onClick={onClick}>{label}</button>
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

import { useConfirmDialogStore } from "@/lib/stores";
import VisualizationPageContent from "./VisualizationPageContent";

describe("VisualizationPageContent delete confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    mockRemoveVisualization.mockResolvedValue({ ok: true });
  });

  it("does not remove a visualization after cancellation, but removes it after confirmation", async () => {
    render(<VisualizationPageContent visualizationId="viz-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(useConfirmDialogStore.getState().config?.description).toBe(
      'Are you sure you want to delete "Revenue by month"? This deletes only this visualization. Dashboard items that reference it may remain and stop working. This action cannot be undone.',
    );

    act(() => useConfirmDialogStore.getState().handleCancel());
    expect(mockRemoveVisualization).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await act(async () => {
      await useConfirmDialogStore.getState().handleConfirm();
    });

    expect(mockRemoveVisualization).toHaveBeenCalledWith({ id: "viz-1" });
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/insights" });
  });

  it("shows one error when visualization deletion fails", async () => {
    mockRemoveVisualization.mockRejectedValueOnce(new Error("delete failed"));
    render(<VisualizationPageContent visualizationId="viz-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await act(async () => {
      await useConfirmDialogStore.getState().handleConfirm();
    });

    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      "Couldn't delete the visualization",
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
