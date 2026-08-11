import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
vi.mock("@/components/shell/context-panel-outlet", () => ({
  useContextPanelSection: () => undefined,
}));
vi.mock("@/components/visualizations/AxisSelectField", () => ({
  AxisSelectField: () => null,
}));
vi.mock("@/components/visualizations/VisualizationDisplay", () => ({
  VisualizationDisplay: () => null,
}));
vi.mock("@/hooks/useInsightPagination", () => ({
  useInsightPagination: () => ({
    columnDisplayNames: {},
    columns: [],
    isReady: true,
    resolvedFields: [],
    sampleRows: [],
    schema: [],
    totalCount: 0,
  }),
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
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
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

import { ConfirmDialog } from "@/components/confirm-dialog";
import { useConfirmDialogStore } from "@/lib/stores";
import VisualizationPageContent from "./VisualizationPageContent";

describe("VisualizationPageContent delete confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmDialogStore.getState().close();
    mockRemoveVisualization.mockResolvedValue({ ok: true });
  });

  it("does not remove a visualization after cancellation, but removes it after confirmation", async () => {
    const user = userEvent.setup();
    render(
      <>
        <VisualizationPageContent visualizationId="viz-1" />
        <ConfirmDialog />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("dialog").textContent).toContain(
      'Are you sure you want to delete "Revenue by month"? This deletes only this visualization. Dashboard items that reference it may remain and stop working. This action cannot be undone.',
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockRemoveVisualization).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    await waitFor(() => {
      expect(mockRemoveVisualization).toHaveBeenCalledWith({ id: "viz-1" });
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/insights" });
    });
  });

  it("shows one error when visualization deletion fails", async () => {
    const user = userEvent.setup();
    mockRemoveVisualization.mockRejectedValueOnce(new Error("delete failed"));
    render(
      <>
        <VisualizationPageContent visualizationId="viz-1" />
        <ConfirmDialog />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledTimes(1);
      expect(mockToastError).toHaveBeenCalledWith(
        "Couldn't delete the visualization",
      );
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
