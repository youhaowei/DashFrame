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
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockCommitBatch, mockNavigate } = vi.hoisted(() => ({
  mockCommitBatch: vi.fn(),
  mockNavigate: vi.fn(),
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
    if (ref._path === "listVisualizations") return { data: [REVENUE, ORDERS] };
    if (ref._path === "listInsights") return { data: [] };
    if (ref._path === "listDataTables") return { data: [] };
    throw new Error(`Unexpected query: ${ref._path}`);
  }),
  useMutation: nativeMutationMock((ref: { _path: string }) => {
    if (ref._path !== "commitBatch")
      throw new Error(`Unexpected mutation: ${ref._path}`);
    return { mutateAsync: mockCommitBatch };
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => mockNavigate,
}));

vi.mock("@/hooks/useCreateInsight", () => ({
  useCreateInsight: () => ({ createChartInsight: vi.fn() }),
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
import { useReportChartTabs } from "@/lib/reports/chart-tabs";
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
function Page({ initialChart = null }: { initialChart?: string | null }) {
  const [chart, setChart] = useState<string | null>(initialChart);
  return (
    <PlatformProvider>
      <output data-testid="url-chart">{chart ?? ""}</output>
      <TopBarTabsProvider>
        <TopBarProbe />
        <DashboardDetailContent
          dashboardId={REPORT_ID}
          chartId={chart}
          onSelectChart={setChart}
        />
      </TopBarTabsProvider>
    </PlatformProvider>
  );
}

const urlChart = () => screen.getByTestId("url-chart").textContent;
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

beforeEach(() => {
  vi.clearAllMocks();
  useReportChartTabs.setState({ tabsByReport: {} });
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

    expect(urlChart()).toBe(REVENUE.id);
    expect(tabLabels()).toEqual(["Weekly sales", "Revenue by region"]);
    expect(selectedTab()).toBe("Revenue by region");
    screen.getByText(`Editing ${REVENUE.id}`);
    tabs().getByRole("button", { name: "Close Revenue by region" });

    // The report tab brings the report back; the chart stays open.
    await user.click(tabs().getByRole("tab", { name: "Weekly sales" }));
    expect(urlChart()).toBe("");
    expect(tabLabels()).toEqual(["Weekly sales", "Revenue by region"]);
    screen.getByRole("tabpanel", { name: "Report" });
  });

  it("opens the chart a link names, and the report for a chart that is gone", () => {
    const { unmount } = render(<Page initialChart={ORDERS.id} />);
    expect(selectedTab()).toBe("Orders by month");
    screen.getByText(`Editing ${ORDERS.id}`);
    unmount();

    useReportChartTabs.setState({ tabsByReport: {} });
    render(<Page initialChart="deleted-chart" />);
    expect(urlChart()).toBe("");
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
    expect(urlChart()).toBe(ORDERS.id);
    expect(tabLabels()).toEqual(["Weekly sales", "Orders by month"]);

    await user.click(
      tabs().getByRole("button", { name: "Close Orders by month" }),
    );
    expect(urlChart()).toBe("");
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

    expect(urlChart()).toBe("");
    expect(tabLabels()).toEqual(["Weekly sales"]);
  });

  it("discards the insight of a new chart closed before it reached the report", async () => {
    const user = userEvent.setup();
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

    expect(urlChart()).toBe("");
    expect(mockCommitBatch).toHaveBeenCalledWith({
      commands: [
        expect.objectContaining({
          path: "deleteNode",
          args: { id: "draft-insight" },
        }),
      ],
    });
  });
});
