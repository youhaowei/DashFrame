import { nativeMutationMock } from "@/test/native-query-fixture";
/**
 * ReportChartTab — one chart edited inside a report.
 *
 * - A new chart stays in its tab until it has a field and a metric; then its
 *   chart and tile land on the report in one batch, once.
 * - A saved chart's left pane says how many reports use it.
 */
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockCommitBatch } = vi.hoisted(() => ({ mockCommitBatch: vi.fn() }));

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
  }: {
    view: { kind: string };
    header: (context: unknown) => ReactNode;
    leftPaneNote?: ReactNode;
  }) => (
    <div data-testid="workbench" data-view={view.kind}>
      <header>{header({})}</header>
      {leftPaneNote && <p>{leftPaneNote}</p>}
    </div>
  ),
}));

import type {
  Dashboard,
  DataTable,
  Insight,
  InsightMetric,
  UUID,
  Visualization,
} from "@dashframe/types";
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
  it("opens the chart and says how many reports use it", () => {
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
    render(
      <ReportChartTab
        report={usedBy("report-1")}
        tab={{ id: "chart-1" }}
        reports={[usedBy("report-1"), usedBy("report-2"), REPORT]}
        visualizations={[chart]}
        insights={[insight({})]}
        insightsLoaded
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
});
