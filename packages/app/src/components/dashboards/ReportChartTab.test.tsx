import { nativeMutationMock } from "@/test/native-query-fixture";
/**
 * ReportChartTab — one chart edited inside a report.
 *
 * - A new chart stays in its tab until it has a field and a metric; then its
 *   chart and tile land on the report in one batch, once.
 * - A saved chart's left pane says how many reports use it.
 * - A saved chart can be deleted, after a confirm that says what goes with it.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockCommitBatch, workbenchProps } = vi.hoisted(() => ({
  mockCommitBatch: vi.fn(),
  workbenchProps: {
    starter: undefined as
      | { onPickChartType?: (type: string | undefined) => void }
      | undefined,
  },
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useMutation: nativeMutationMock(() => ({ mutateAsync: mockCommitBatch })),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

// The workbench is covered on its own; this stand-in shows what the tab hands it.
vi.mock("@/components/insights/InsightWorkbench", () => ({
  InsightWorkbench: ({
    view,
    header,
    leftPaneNote,
    starter,
    missingTable,
  }: {
    view: { kind: string };
    header: ReactNode;
    leftPaneNote?: ReactNode;
    starter?: { onPickChartType?: (type: string | undefined) => void };
    missingTable?: ReactNode;
  }) => {
    workbenchProps.starter = starter;
    return (
      <div data-testid="workbench" data-view={view.kind}>
        <header>{header}</header>
        {leftPaneNote && <p>{leftPaneNote}</p>}
        {/* What the workbench shows in place of itself without the table. */}
        <div data-testid="missing-table">{missingTable}</div>
      </div>
    );
  },
}));

import type {
  Dashboard,
  DataTable,
  Insight,
  InsightMetric,
  UUID,
  Visualization,
} from "@dashframe/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import { useReportChartTabs } from "@/lib/reports/chart-tabs";
import { useConfirmDialogStore } from "@/lib/stores";
import { newChartName, ReportChartTab } from "./ReportChartTab";

const FIELD_ID = "10000000-0000-4000-8000-000000000001" as UUID;
const METRIC: InsightMetric = {
  id: "10000000-0000-4000-8000-000000000002" as UUID,
  name: "Total revenue",
  sourceTable: "10000000-0000-4000-8000-000000000003" as UUID,
  columnName: "revenue",
  aggregation: "sum",
};
const TABLE = {
  id: METRIC.sourceTable,
  name: "orders",
  fields: [{ id: FIELD_ID, name: "Region", columnName: "region" }],
} as unknown as DataTable;
const REPORT = {
  id: "report-1",
  name: "Weekly sales",
  items: [],
} as unknown as Dashboard;

function insight(overrides: Partial<Insight>): Insight {
  return {
    id: "insight-1" as UUID,
    name: "orders",
    source: { sourceType: "dataTable", sourceId: TABLE.id },
    selectedFields: [],
    metrics: [],
    createdAt: 0,
    ...overrides,
  } as unknown as Insight;
}

function renderNewChart(chartInsight: Insight, onLanded = vi.fn()) {
  const props = {
    report: REPORT,
    tab: { id: "new-chart", insightId: chartInsight.id },
    reports: [REPORT],
    visualizations: [] as Visualization[],
    dataTables: [TABLE],
    insightsLoaded: true,
    dataTablesLoaded: true,
    onLanded,
  };
  const view = render(<ReportChartTab {...props} insights={[chartInsight]} />);
  return {
    ...view,
    update: (next: Insight) =>
      view.rerender(<ReportChartTab {...props} insights={[next]} />),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useConfirmDialogStore.getState().close();
  mockCommitBatch.mockResolvedValue(null);
});

describe("ReportChartTab — a new chart", () => {
  it("stays off the report until it has both a field and a metric", async () => {
    const onLanded = vi.fn();
    const { update } = renderNewChart(insight({}), onLanded);
    screen.getByText("Add a field and a metric to place it on the report");
    expect(screen.getByTestId("workbench").dataset.view).toBe("table");

    update(insight({ selectedFields: [FIELD_ID] }));
    update(insight({ metrics: [METRIC] }));
    expect(mockCommitBatch).not.toHaveBeenCalled();

    update(insight({ selectedFields: [FIELD_ID], metrics: [METRIC] }));
    await waitFor(() => expect(onLanded).toHaveBeenCalledWith("new-chart"));
    expect(mockCommitBatch).toHaveBeenCalledTimes(1);
    const { commands } = mockCommitBatch.mock.calls[0]![0] as {
      commands: { path: string; args: Record<string, unknown> }[];
    };
    expect(commands.map((command) => command.path)).toEqual([
      "createVisualizationCmd",
      "addDashboardItemCmd",
    ]);
    expect(commands[0]!.args).toMatchObject({
      id: "new-chart",
      name: "Total revenue by Region",
    });

    // A later edit while the tab catches up does not place it again.
    update(
      insight({ selectedFields: [FIELD_ID], metrics: [METRIC], name: "x" }),
    );
    expect(mockCommitBatch).toHaveBeenCalledTimes(1);
  });
});

describe("ReportChartTab — a new chart started from a suggestion", () => {
  it("lands as the chart type its tab carries", async () => {
    const onLanded = vi.fn();
    const ready = insight({ selectedFields: [FIELD_ID], metrics: [METRIC] });
    render(
      <ReportChartTab
        report={REPORT}
        tab={{ id: "new-chart", insightId: ready.id, chartType: "line" }}
        reports={[REPORT]}
        visualizations={[]}
        insights={[ready]}
        insightsLoaded
        dataTablesLoaded
        dataTables={[TABLE]}
        onLanded={onLanded}
      />,
    );
    await waitFor(() => expect(onLanded).toHaveBeenCalledWith("new-chart"));
    const { commands } = mockCommitBatch.mock.calls[0]![0] as {
      commands: { path: string; args: Record<string, unknown> }[];
    };
    expect(commands[0]!.args).toMatchObject({ visualizationType: "line" });
  });
});

describe("ReportChartTab — a new chart remounted mid-landing", () => {
  it("does not place the chart a second time", async () => {
    let resolveLanding: (value: null) => void = () => {};
    mockCommitBatch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLanding = resolve;
      }),
    );
    const ready = insight({ selectedFields: [FIELD_ID], metrics: [METRIC] });
    const onLanded = vi.fn();
    const first = renderNewChart(ready, onLanded);
    expect(mockCommitBatch).toHaveBeenCalledTimes(1);

    // Switching to the report and back mounts the tab afresh.
    first.unmount();
    renderNewChart(ready, onLanded);
    expect(mockCommitBatch).toHaveBeenCalledTimes(1);

    resolveLanding(null);
    await waitFor(() => expect(onLanded).toHaveBeenCalledWith("new-chart"));
  });
});

describe("ReportChartTab — a new chart whose insight is gone", () => {
  it("says so instead of loading forever", () => {
    render(
      <ReportChartTab
        report={REPORT}
        tab={{ id: "new-chart", insightId: "deleted-insight" }}
        reports={[REPORT]}
        visualizations={[]}
        insights={[]}
        insightsLoaded
        dataTablesLoaded
        dataTables={[TABLE]}
        onLanded={vi.fn()}
      />,
    );
    screen.getByText(
      "This chart is gone. Close its tab to go back to the report.",
    );
  });
});

describe("ReportChartTab — a saved chart", () => {
  const chart = {
    id: "chart-1",
    name: "Revenue by region",
    insightId: "insight-1",
    visualizationType: "barY",
  } as unknown as Visualization;
  const usedBy = (id: string) =>
    ({
      id,
      items: [
        {
          id: `${id}-tile`,
          type: "visualization",
          visualizationId: "chart-1",
        },
      ],
    }) as unknown as Dashboard;

  it("opens the chart and says how many reports use it", () => {
    render(
      <ReportChartTab
        report={usedBy("report-1")}
        tab={{ id: "chart-1" }}
        reports={[usedBy("report-1"), usedBy("report-2"), REPORT]}
        visualizations={[chart]}
        insights={[insight({})]}
        insightsLoaded
        dataTablesLoaded
        dataTables={[TABLE]}
        onLanded={vi.fn()}
      />,
    );

    expect(screen.getByTestId("workbench").dataset.view).toBe("visualization");
    screen.getByText("Used in 2 reports");
    expect(
      (screen.getByLabelText("Chart name") as HTMLInputElement).value,
    ).toBe("Revenue by region");
  });

  const savedChart = (
    reports: Dashboard[],
    tables: { loaded?: boolean; list?: DataTable[] } = {},
  ) => (
    <>
      <ReportChartTab
        report={reports[0]!}
        tab={{ id: "chart-1" }}
        reports={reports}
        visualizations={[chart]}
        insights={[insight({})]}
        insightsLoaded
        dataTablesLoaded={tables.loaded ?? true}
        dataTables={tables.list ?? [TABLE]}
        onLanded={vi.fn()}
      />
      <ConfirmDialog />
    </>
  );
  // The server takes the chart's tiles off its reports and keeps the insight
  // if something else is built on it by then; the client sends only these.
  const deleteChartAndUnusedInsight = [
    { path: "deleteNode", args: { id: "chart-1" } },
    { path: "deleteNode", args: { id: "insight-1", ifUnused: true } },
  ];
  const openDelete = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(
      screen.getByRole("button", { name: "More chart actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /Delete chart/ }),
    );
  };

  it("deletes the chart and its unused insight, once confirmed", async () => {
    const user = userEvent.setup();
    useReportChartTabs.getState().open("report-1", { id: "chart-1" });
    useReportChartTabs.getState().open("report-2", { id: "chart-1" });
    render(savedChart([usedBy("report-1"), usedBy("report-2"), REPORT]));

    await openDelete(user);
    expect(screen.getByRole("dialog").textContent).toContain(
      'Are you sure you want to delete "Revenue by region"? It will be removed from 2 reports, including this one. Its insight will be deleted with it, unless something else starts using it first. This action cannot be undone.',
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockCommitBatch).not.toHaveBeenCalled();

    await openDelete(user);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockCommitBatch).toHaveBeenCalledWith({
        commands: deleteChartAndUnusedInsight,
      }),
    );
    // No report keeps a tab for a chart that is gone.
    await waitFor(() =>
      expect(
        Object.values(useReportChartTabs.getState().tabsByReport)
          .flat()
          .map((tab) => tab.id),
      ).not.toContain("chart-1"),
    );
  });

  it("asks again when what the dialog said no longer holds", async () => {
    const user = userEvent.setup();
    const view = render(savedChart([usedBy("report-1")]));

    await openDelete(user);
    expect(screen.getByRole("dialog").textContent).toContain(
      "It will be removed from this report.",
    );
    // The chart is placed on another report while the dialog is open.
    view.rerender(savedChart([usedBy("report-1"), usedBy("report-2")]));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.getByRole("dialog").textContent).toContain(
        'Where this chart is used changed while you were deciding. Are you sure you want to delete "Revenue by region"? It will be removed from 2 reports, including this one.',
      ),
    );
    expect(mockCommitBatch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockCommitBatch).toHaveBeenCalledWith({
        commands: deleteChartAndUnusedInsight,
      }),
    );
  });

  it("can still be deleted when its table is gone", async () => {
    const user = userEvent.setup();
    render(savedChart([usedBy("report-1")], { list: [] }));

    // The workbench shows this in place of its header, menu included.
    await user.click(
      within(screen.getByTestId("missing-table")).getByRole("button", {
        name: "Delete chart",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockCommitBatch).toHaveBeenCalledWith({
        commands: deleteChartAndUnusedInsight,
      }),
    );
  });

  it("offers no delete in place of the workbench unless the table is known gone", () => {
    const deleteInPlace = () =>
      within(screen.getByTestId("missing-table")).queryByRole("button", {
        name: "Delete chart",
      });
    // The workbench shows its missing-table message while its lists load.
    const view = render(savedChart([usedBy("report-1")], { loaded: false }));
    expect(deleteInPlace()).toBeNull();
    view.rerender(
      savedChart([usedBy("report-1")], { loaded: false, list: [] }),
    );
    expect(deleteInPlace()).toBeNull();
    // Loaded, and the table is there: the chart is not broken.
    view.rerender(savedChart([usedBy("report-1")]));
    expect(deleteInPlace()).toBeNull();
  });

  it("deletes a chart however many tiles it has", async () => {
    const user = userEvent.setup();
    const crowded = {
      id: "report-1",
      items: Array.from({ length: 500 }, (_, index) => ({
        id: `tile-${index}`,
        type: "visualization",
        visualizationId: "chart-1",
      })),
    } as unknown as Dashboard;
    render(savedChart([crowded]));

    await openDelete(user);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockCommitBatch).toHaveBeenCalledWith({
        commands: deleteChartAndUnusedInsight,
      }),
    );
  });

  it("closes its confirm dialog when the tab goes away", async () => {
    const user = userEvent.setup();
    const view = render(savedChart([usedBy("report-1")]));
    await openDelete(user);
    expect(useConfirmDialogStore.getState().isOpen).toBe(true);

    view.unmount();
    expect(useConfirmDialogStore.getState().isOpen).toBe(false);
  });

  it("keeps the chart and says so when the delete fails", async () => {
    const user = userEvent.setup();
    mockCommitBatch.mockRejectedValueOnce(new Error("offline"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    render(savedChart([usedBy("report-1")]));

    await openDelete(user);
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't delete the chart"),
    );
    // The action is available again for another try.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "More chart actions" }),
      ).toHaveProperty("disabled", false),
    );
    logged.mockRestore();
  });
});

describe("ReportChartTab — a new chart without its table", () => {
  it("offers nothing to delete: it has no saved chart", () => {
    renderNewChart(insight({}));
    expect(
      within(screen.getByTestId("missing-table")).queryByRole("button", {
        name: "Delete chart",
      }),
    ).toBeNull();
  });
});

describe("newChartName", () => {
  it("names the chart after what it plots, else after its insight", () => {
    expect(
      newChartName(insight({ selectedFields: [FIELD_ID], metrics: [METRIC] }), [
        TABLE,
      ]),
    ).toBe("Total revenue by Region");
    expect(newChartName(insight({}), [TABLE])).toBe("orders");
  });

  it("lands as the default type when a reload left a suggestion's type behind and the chart was built by hand", async () => {
    // A card was picked, then the page reloaded before its write landed: the
    // tab comes back from session storage with the type, the insight pristine.
    const store = useReportChartTabs.getState();
    store.open(REPORT.id, { id: "new-chart", insightId: "insight-1" });
    store.setChartType(REPORT.id, "new-chart", "line");
    const tabOf = () =>
      useReportChartTabs
        .getState()
        .tabsByReport[REPORT.id]!.find((tab) => tab.id === "new-chart")!;
    const onLanded = vi.fn();
    const props = {
      report: REPORT,
      reports: [REPORT],
      visualizations: [] as Visualization[],
      dataTables: [TABLE],
      insightsLoaded: true,
      dataTablesLoaded: true,
      onLanded,
    };
    const view = render(
      <ReportChartTab {...props} tab={tabOf()} insights={[insight({})]} />,
    );

    // A header action is the first step of a manual build.
    workbenchProps.starter!.onPickChartType!(undefined);
    expect(tabOf().chartType).toBeUndefined();

    view.rerender(
      <ReportChartTab
        {...props}
        tab={tabOf()}
        insights={[insight({ selectedFields: [FIELD_ID], metrics: [METRIC] })]}
      />,
    );
    await waitFor(() => expect(onLanded).toHaveBeenCalledWith("new-chart"));
    const { commands } = mockCommitBatch.mock.calls[0]![0] as {
      commands: { path: string; args: Record<string, unknown> }[];
    };
    expect(commands[0]!.args.visualizationType).not.toBe("line");
  });

  it("drops a restored type whose write never landed, before any build", async () => {
    const store = useReportChartTabs.getState();
    store.open(REPORT.id, { id: "restored", insightId: "insight-1" });
    store.setChartType(REPORT.id, "restored", "line");
    const tabOf = () =>
      useReportChartTabs
        .getState()
        .tabsByReport[REPORT.id]!.find((tab) => tab.id === "restored")!;
    const onLanded = vi.fn();
    const props = {
      report: REPORT,
      reports: [REPORT],
      visualizations: [] as Visualization[],
      dataTables: [TABLE],
      insightsLoaded: true,
      dataTablesLoaded: true,
      onLanded,
    };
    const view = render(
      <ReportChartTab {...props} tab={tabOf()} insights={[insight({})]} />,
    );
    // No pick this session: the type is stale as soon as the tab opens.
    await waitFor(() => expect(tabOf().chartType).toBeUndefined());

    // The left pane then builds the chart; it lands as the default type.
    view.rerender(
      <ReportChartTab
        {...props}
        tab={tabOf()}
        insights={[insight({ selectedFields: [FIELD_ID], metrics: [METRIC] })]}
      />,
    );
    await waitFor(() => expect(onLanded).toHaveBeenCalledWith("restored"));
    const { commands } = mockCommitBatch.mock.calls[0]![0] as {
      commands: { path: string; args: Record<string, unknown> }[];
    };
    expect(commands[0]!.args.visualizationType).not.toBe("line");
  });

  it("keeps a type picked this session while its write is pending", () => {
    const store = useReportChartTabs.getState();
    store.open(REPORT.id, { id: "picked", insightId: "insight-1" });
    const tabOf = () =>
      useReportChartTabs
        .getState()
        .tabsByReport[REPORT.id]!.find((tab) => tab.id === "picked")!;
    const props = {
      report: REPORT,
      reports: [REPORT],
      visualizations: [] as Visualization[],
      dataTables: [TABLE],
      insightsLoaded: true,
      dataTablesLoaded: true,
      onLanded: vi.fn(),
    };
    const view = render(
      <ReportChartTab {...props} tab={tabOf()} insights={[insight({})]} />,
    );
    workbenchProps.starter!.onPickChartType!("line");
    view.rerender(
      <ReportChartTab {...props} tab={tabOf()} insights={[insight({})]} />,
    );
    expect(tabOf().chartType).toBe("line");
  });
});
