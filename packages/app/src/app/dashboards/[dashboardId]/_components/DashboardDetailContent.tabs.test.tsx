import {
  nativeMutationMock,
  nativeQueryMock,
} from "@/test/native-query-fixture";
/**
 * DashboardDetailContent — charts edited in tabs inside the report.
 *
 * - The report is the first tab and cannot be closed; each chart opened
 *   from a tile is a closable tab after it.
 * - The open tab lives in the URL (here, in state): a link to a chart opens
 *   it, a link to a chart that is gone opens the report.
 * - Closing the open tab opens its neighbour, else the report; closing a new
 *   chart that never reached the report discards the insight it was built on.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const {
  mockCommitBatch,
  mockNavigate,
  mockCreateChartInsight,
  mockToastError,
  server,
} = vi.hoisted(() => ({
  mockCommitBatch: vi.fn(),
  mockNavigate: vi.fn(),
  mockCreateChartInsight: vi.fn(),
  mockToastError: vi.fn(),
  // What the queries return; `undefined` is still loading.
  server: {
    visualizations: undefined as unknown[] | undefined,
    insights: undefined as unknown[] | undefined,
  },
}));

const REPORT_ID = "report-1";
const REVENUE = {
  id: "chart-revenue",
  name: "Revenue by region",
  insightId: "insight-1",
  visualizationType: "barY",
  encoding: {},
  spec: {},
};
const ORDERS = {
  id: "chart-orders",
  name: "Orders by month",
  insightId: "insight-1",
  visualizationType: "line",
  encoding: {},
  spec: {},
};
const REPORT = {
  id: REPORT_ID,
  name: "Weekly sales",
  items: [
    {
      id: "item-1",
      type: "visualization",
      visualizationId: REVENUE.id,
      x: 0,
      y: 0,
      width: 6,
      height: 6,
    },
    {
      id: "item-2",
      type: "visualization",
      visualizationId: ORDERS.id,
      x: 6,
      y: 0,
      width: 6,
      height: 6,
    },
  ],
  controls: [],
};

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery_experimental: nativeQueryMock((ref: { _path: string }) => {
    if (ref._path === "listDashboards") return { data: [REPORT] };
    if (ref._path === "listVisualizations")
      return { data: server.visualizations };
    if (ref._path === "listInsights") return { data: server.insights };
    if (ref._path === "listDataTables") return { data: [] };
    throw new Error(`Unexpected query: ${ref._path}`);
  }),
  useMutation: nativeMutationMock((ref: { _path: string }) => {
    if (ref._path !== "commitBatch")
      throw new Error(`Unexpected mutation: ${ref._path}`);
    return { mutateAsync: mockCommitBatch };
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: mockToastError, success: vi.fn() },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => mockNavigate,
}));

vi.mock("@/hooks/useCreateInsight", () => ({
  useCreateInsight: () => ({ createChartInsight: mockCreateChartInsight }),
}));

// The table picker is covered on its own; here it offers one table.
vi.mock("@/components/data-sources/DataPickerModal", () => ({
  DataPickerModal: ({
    isOpen,
    onClose,
    onTableSelect,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onTableSelect: (tableId: string, tableName: string) => unknown;
  }) =>
    isOpen ? (
      <>
        <button
          type="button"
          onClick={() => onTableSelect("table-1", "orders")}
        >
          Pick orders
        </button>
        <button type="button" onClick={onClose}>
          Close picker
        </button>
      </>
    ) : null,
}));

// The grid's layout engine is not under test: each tile is its Edit button.
vi.mock("@/components/dashboards/DashboardGrid", () => ({
  DashboardGrid: ({
    dashboard,
    onEditChart,
  }: {
    dashboard: typeof REPORT;
    onEditChart: (id: string) => void;
  }) => (
    <div>
      {dashboard.items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onEditChart(item.visualizationId)}
        >
          Edit {item.visualizationId}
        </button>
      ))}
    </div>
  ),
}));

// The workbench is covered on its own; here a chart tab just names its chart.
vi.mock("@/components/dashboards/ReportChartTab", () => ({
  ReportChartTab: ({ tab }: { tab: { id: string } }) => <p>Editing {tab.id}</p>,
}));

import {
  TopBarTabsProvider,
  useRegisteredTopBarTabs,
} from "@/components/shell/topbar-tabs";
import { PlatformProvider } from "@/lib/platform";
import {
  chartCreating,
  chartLanding,
  useChartWrites,
  useReportChartTabs,
} from "@/lib/reports/chart-tabs";
import DashboardDetailContent from "./DashboardDetailContent";

/** Mirrors the top-bar slot: what the page registered, as clickable tabs. */
function TopBarProbe() {
  const tabs = useRegisteredTopBarTabs();
  if (!tabs) return <p data-testid="no-tabs" />;
  return (
    <div role="tablist" aria-label={tabs.label}>
      {tabs.tabs.map((tab) => (
        <span key={tab.id}>
          <button
            type="button"
            role="tab"
            aria-selected={tab.id === tabs.activeId}
            onClick={() => tabs.onSelect(tab.id)}
          >
            {tab.label}
          </button>
          {tab.closable && (
            <button type="button" onClick={() => tabs.onClose?.(tab.id)}>
              Close {tab.label}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/** The route's part: the open chart lives in the URL, here in state. */
function Page({
  initialChart = null,
  openChartPicker,
}: {
  initialChart?: string | null;
  openChartPicker?: boolean;
}) {
  const [chart, setChart] = useState<string | null>(initialChart);
  return (
    <PlatformProvider>
      <output data-testid="url-chart">{chart ?? ""}</output>
      <TopBarTabsProvider>
        <TopBarProbe />
        <DashboardDetailContent
          dashboardId={REPORT_ID}
          chartId={chart}
          onSelectChart={(id) =>
            // Like the router, the URL changes after the click returns.
            setTimeout(() => setChart(id), 0)
          }
          openChartPicker={openChartPicker}
        />
      </TopBarTabsProvider>
    </PlatformProvider>
  );
}

const urlChart = () => screen.getByTestId("url-chart").textContent;
const LABELS: Record<string, string> = {
  "": REPORT.name,
  [REVENUE.id]: REVENUE.name,
  [ORDERS.id]: ORDERS.name,
};
// The top bar hears about tabs in an effect, a commit after the URL changes,
// so wait for both.
const expectUrl = (chart: string) =>
  waitFor(() => {
    expect(urlChart()).toBe(chart);
    expect(selectedTab()).toBe(LABELS[chart]);
  });
const tabs = () =>
  within(screen.getByRole("tablist", { name: "Report and its charts" }));
const tabLabels = () =>
  tabs()
    .getAllByRole("tab")
    .map((tab) => tab.textContent);
const selectedTab = () =>
  tabs()
    .getAllByRole("tab")
    .find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;

const storedTabs = () =>
  useReportChartTabs.getState().tabsByReport[REPORT_ID] ?? [];
const withNewChart = (tab: Record<string, unknown>) =>
  useReportChartTabs.setState({
    tabsByReport: { [REPORT_ID]: [{ id: "new-chart", ...tab }] },
  });
const discards = () =>
  mockCommitBatch.mock.calls.filter(([batch]) =>
    (batch as { commands: { path: string }[] }).commands.some(
      (command) => command.path === "deleteNode",
    ),
  );

beforeEach(() => {
  vi.clearAllMocks();
  useReportChartTabs.setState({ tabsByReport: {} });
  useChartWrites.setState({ creating: new Set(), landing: new Set() });
  server.visualizations = [REVENUE, ORDERS];
  server.insights = [];
  mockCommitBatch.mockResolvedValue(null);
});

describe("DashboardDetailContent — chart tabs", () => {
  it("shows the report as the first tab, which cannot be closed", () => {
    render(<Page />);

    expect(tabLabels()).toEqual(["Weekly sales"]);
    expect(selectedTab()).toBe("Weekly sales");
    expect(tabs().queryByRole("button", { name: /Close/ })).toBeNull();
    screen.getByRole("tabpanel", { name: "Report" });
  });

  it("opens a tile's chart as a closable tab and puts it in the URL", async () => {
    const user = userEvent.setup();
    render(<Page />);

    await user.click(
      screen.getByRole("button", { name: `Edit ${REVENUE.id}` }),
    );

    await expectUrl(REVENUE.id);
    expect(tabLabels()).toEqual(["Weekly sales", "Revenue by region"]);
    expect(selectedTab()).toBe("Revenue by region");
    screen.getByText(`Editing ${REVENUE.id}`);
    tabs().getByRole("button", { name: "Close Revenue by region" });

    // The report tab brings the report back; the chart stays open.
    await user.click(tabs().getByRole("tab", { name: "Weekly sales" }));
    await expectUrl("");
    expect(tabLabels()).toEqual(["Weekly sales", "Revenue by region"]);
    screen.getByRole("tabpanel", { name: "Report" });
  });

  it("opens the chart a link names, and the report for a chart that is gone", async () => {
    const { unmount } = render(<Page initialChart={ORDERS.id} />);
    expect(selectedTab()).toBe("Orders by month");
    screen.getByText(`Editing ${ORDERS.id}`);
    unmount();

    useReportChartTabs.setState({ tabsByReport: {} });
    render(<Page initialChart="deleted-chart" />);
    await expectUrl("");
    expect(tabLabels()).toEqual(["Weekly sales"]);
  });

  it("closes the open tab to its neighbour, then to the report", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(
      screen.getByRole("button", { name: `Edit ${REVENUE.id}` }),
    );
    await user.click(tabs().getByRole("tab", { name: "Weekly sales" }));
    await user.click(screen.getByRole("button", { name: `Edit ${ORDERS.id}` }));
    await user.click(tabs().getByRole("tab", { name: "Revenue by region" }));

    await user.click(
      tabs().getByRole("button", { name: "Close Revenue by region" }),
    );
    await expectUrl(ORDERS.id);
    expect(tabLabels()).toEqual(["Weekly sales", "Orders by month"]);

    await user.click(
      tabs().getByRole("button", { name: "Close Orders by month" }),
    );
    await expectUrl("");
    expect(tabLabels()).toEqual(["Weekly sales"]);
    expect(mockCommitBatch).not.toHaveBeenCalled();
  });

  it("closes the open chart with ⌘W", async () => {
    render(<Page initialChart={REVENUE.id} />);
    expect(selectedTab()).toBe("Revenue by region");

    // ⌘ on macOS, Ctrl elsewhere — whichever this test runtime reports.
    const isMac = /mac/i.test(navigator.platform);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "w",
          metaKey: isMac,
          ctrlKey: !isMac,
        }),
      );
    });

    await expectUrl("");
    expect(tabLabels()).toEqual(["Weekly sales"]);
  });

  it("discards the insight of a new chart closed before it reached the report", async () => {
    const user = userEvent.setup();
    server.insights = [{ id: "draft-insight", name: "orders" }];
    useReportChartTabs.setState({
      tabsByReport: {
        [REPORT_ID]: [{ id: "new-chart", insightId: "draft-insight" }],
      },
    });
    render(<Page initialChart="new-chart" />);
    expect(tabLabels()).toEqual(["Weekly sales", "Untitled chart"]);

    await user.click(
      tabs().getByRole("button", { name: "Close Untitled chart" }),
    );

    await expectUrl("");
    expect(mockCommitBatch).toHaveBeenCalledWith({
      commands: [
        expect.objectContaining({
          path: "deleteNode",
          args: { id: "draft-insight" },
        }),
      ],
    });
  });

  it("keeps the insight of a new chart once a chart is built on it", async () => {
    const user = userEvent.setup();
    useReportChartTabs.setState({
      tabsByReport: {
        [REPORT_ID]: [{ id: "new-chart", insightId: REVENUE.insightId }],
      },
    });
    render(<Page initialChart="new-chart" />);
    await user.click(
      tabs().getByRole("button", { name: "Close Untitled chart" }),
    );
    await expectUrl("");
    expect(mockCommitBatch).not.toHaveBeenCalled();
  });

  it("keeps the insight of a new chart whose landing is still in flight", async () => {
    const user = userEvent.setup();
    useReportChartTabs.setState({
      tabsByReport: {
        [REPORT_ID]: [{ id: "new-chart", insightId: "draft-insight" }],
      },
    });
    chartLanding.start("new-chart");
    try {
      render(<Page initialChart="new-chart" />);
      await user.click(
        tabs().getByRole("button", { name: "Close Untitled chart" }),
      );
      await expectUrl("");
      expect(mockCommitBatch).not.toHaveBeenCalled();
    } finally {
      chartLanding.finish("new-chart");
    }
  });

  it("never discards a landed chart while the charts are still loading", async () => {
    const user = userEvent.setup();
    // The landing committed, then the page reloaded before the tab heard.
    withNewChart({ insightId: "insight-new" });
    server.visualizations = undefined;
    const { rerender } = render(<Page initialChart="new-chart" />);

    await user.click(
      tabs().getByRole("button", { name: "Close Untitled chart" }),
    );
    expect(discards()).toHaveLength(0);

    server.visualizations = [
      REVENUE,
      ORDERS,
      { ...REVENUE, id: "new-chart", insightId: "insight-new" },
    ];
    rerender(<Page initialChart="new-chart" />);

    await waitFor(() => expect(storedTabs()).toEqual([]));
    expect(discards()).toHaveLength(0);
  });

  it("discards a new chart closed mid-landing once the landing fails", async () => {
    const user = userEvent.setup();
    withNewChart({ insightId: "draft-insight" });
    server.insights = [{ id: "draft-insight", name: "orders" }];
    act(() => chartLanding.start("new-chart"));
    render(<Page initialChart="new-chart" />);

    await user.click(
      tabs().getByRole("button", { name: "Close Untitled chart" }),
    );
    await expectUrl("");
    expect(discards()).toHaveLength(0);
    expect(storedTabs()).toEqual([
      { id: "new-chart", insightId: "draft-insight", closing: true },
    ]);

    // The landing batch rejects: nothing reached the report.
    act(() => chartLanding.finish("new-chart"));

    await waitFor(() => expect(discards()).toHaveLength(1));
    expect(discards()[0]![0]).toEqual({
      commands: [
        expect.objectContaining({
          path: "deleteNode",
          args: { id: "draft-insight" },
        }),
      ],
    });
    await waitFor(() => expect(storedTabs()).toEqual([]));
  });

  it("finishes the close of a new chart whose landing then succeeds", async () => {
    const user = userEvent.setup();
    withNewChart({ insightId: "draft-insight" });
    act(() => chartLanding.start("new-chart"));
    render(<Page initialChart="new-chart" />);

    await user.click(
      tabs().getByRole("button", { name: "Close Untitled chart" }),
    );
    act(() => {
      useReportChartTabs.getState().land(REPORT_ID, "new-chart");
      chartLanding.finish("new-chart");
    });

    expect(storedTabs()).toEqual([]);
    expect(discards()).toHaveLength(0);
  });

  it("keeps a new chart's tab when discarding its insight fails, and retries", async () => {
    const user = userEvent.setup();
    withNewChart({ insightId: "draft-insight" });
    server.insights = [{ id: "draft-insight", name: "orders" }];
    mockCommitBatch.mockRejectedValueOnce(new Error("write failed"));
    render(<Page initialChart="new-chart" />);

    await user.click(
      tabs().getByRole("button", { name: "Close Untitled chart" }),
    );

    await waitFor(() =>
      expect(tabLabels()).toEqual(["Weekly sales", "Untitled chart"]),
    );
    expect(storedTabs()).toEqual([
      { id: "new-chart", insightId: "draft-insight" },
    ]);
    expect(mockToastError).toHaveBeenCalledWith(
      "Couldn't discard the new chart",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Try again" }),
      }),
    );

    // Try again sends the discard again; this time it goes through.
    const [, { action }] = mockToastError.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    act(() => action.onClick());
    await waitFor(() => expect(discards()).toHaveLength(2));
    await waitFor(() => expect(storedTabs()).toEqual([]));
  });

  it("closes a new chart whose insight was deleted elsewhere", async () => {
    const user = userEvent.setup();
    withNewChart({ insightId: "deleted-insight" });
    render(<Page initialChart="new-chart" />);

    await user.click(
      tabs().getByRole("button", { name: "Close Untitled chart" }),
    );

    await waitFor(() => expect(storedTabs()).toEqual([]));
    expect(discards()).toHaveLength(0);
  });

  it("records a new chart's tab before its insight is created", async () => {
    const user = userEvent.setup();
    let finishCreate: (id: string | null) => void = () => {};
    mockCreateChartInsight.mockImplementation(
      (_tableId: string, _tableName: string, id: string) => {
        // The record exists before the create is sent.
        expect(storedTabs()).toEqual([
          { id: expect.any(String), insightId: id, creating: true },
        ]);
        return new Promise((resolve) => {
          finishCreate = resolve;
        });
      },
    );
    render(<Page />);

    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.click(await screen.findByRole("menuitem", { name: /Chart/ }));
    await user.click(screen.getByRole("button", { name: "Pick orders" }));
    expect(mockCreateChartInsight).toHaveBeenCalledTimes(1);
    const [{ insightId }] = storedTabs() as [{ insightId: string }];

    // Listed on the server: the tab is a new chart now.
    server.insights = [{ id: insightId, name: "orders" }];
    await act(async () => finishCreate(insightId));
    await waitFor(() =>
      expect(storedTabs()).toEqual([{ id: expect.any(String), insightId }]),
    );
    expect(chartCreating.isPending(storedTabs()[0]!.id)).toBe(false);
  });

  it("drops a tab whose create a reload interrupted before it was sent", async () => {
    withNewChart({ insightId: "never-created", creating: true });
    render(<Page />);

    await waitFor(() => expect(storedTabs()).toEqual([]));
    expect(discards()).toHaveLength(0);
  });

  it("keeps a tab whose create a reload interrupted after it committed", async () => {
    withNewChart({ insightId: "insight-new", creating: true });
    server.insights = [{ id: "insight-new", name: "orders" }];
    render(<Page />);

    await waitFor(() =>
      expect(storedTabs()).toEqual([
        { id: "new-chart", insightId: "insight-new" },
      ]),
    );
  });
});

describe("DashboardDetailContent — first report", () => {
  it("opens with the chart picker only when asked to", () => {
    const { unmount } = render(<Page />);
    expect(screen.queryByRole("button", { name: "Pick orders" })).toBeNull();
    unmount();

    render(<Page openChartPicker />);
    screen.getByRole("button", { name: "Pick orders" });
  });

  it("leaves the report as it was when the picker is closed", async () => {
    const user = userEvent.setup();
    render(<Page openChartPicker />);

    await user.click(screen.getByRole("button", { name: "Close picker" }));

    expect(screen.queryByRole("button", { name: "Pick orders" })).toBeNull();
    screen.getByRole("tabpanel", { name: "Report" });
    expect(mockCommitBatch).not.toHaveBeenCalled();
  });
});
