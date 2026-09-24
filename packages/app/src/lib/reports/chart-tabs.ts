import type {
  Dashboard,
  DashboardItem,
  Insight,
  UUID,
  VisualizationType,
} from "@dashframe/types";
import { cmd, fieldEncoding, metricEncoding } from "@dashframe/types";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * A chart open as a tab in a report. A saved chart's id is its
 * visualization's. A new chart has no visualization yet: it carries the
 * insight it is being built on, and its id becomes the visualization's when
 * its tile lands on the report — so the URL never changes under it.
 */
export interface ChartTab {
  id: string;
  /** Set while the chart is new and not on the report yet. */
  insightId?: string;
}

interface ReportChartTabsState {
  tabsByReport: Record<string, ChartTab[]>;
  open: (reportId: string, tab: ChartTab) => void;
  close: (reportId: string, tabId: string) => void;
  /** The new chart's tile is on the report; the tab is a saved chart now. */
  land: (reportId: string, tabId: string) => void;
}

const safeSessionStorage = {
  getItem: (name: string): string | null => {
    if (typeof window === "undefined") return null;
    try {
      return window.sessionStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(name, value);
    } catch {
      /* best-effort */
    }
  },
  removeItem: (name: string): void => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.removeItem(name);
    } catch {
      /* best-effort */
    }
  },
};

/**
 * The charts open in each report, for this browser session. Closing a tab
 * only takes it off the strip. Kept in session storage so a reload keeps the
 * tabs — including a new chart that has no tile yet, which exists nowhere
 * else — while a fresh session opens each report on its own.
 */
export const useReportChartTabs = create<ReportChartTabsState>()(
  persist(
    (set) => ({
      tabsByReport: {},
      open: (reportId, tab) =>
        set((state) => {
          const current = state.tabsByReport[reportId] ?? [];
          if (current.some((open) => open.id === tab.id)) return state;
          return {
            tabsByReport: {
              ...state.tabsByReport,
              [reportId]: [...current, tab],
            },
          };
        }),
      close: (reportId, tabId) =>
        set((state) => ({
          tabsByReport: {
            ...state.tabsByReport,
            [reportId]: (state.tabsByReport[reportId] ?? []).filter(
              (tab) => tab.id !== tabId,
            ),
          },
        })),
      land: (reportId, tabId) =>
        set((state) => ({
          tabsByReport: {
            ...state.tabsByReport,
            [reportId]: (state.tabsByReport[reportId] ?? []).map((tab) =>
              tab.id === tabId ? { id: tab.id } : tab,
            ),
          },
        })),
    }),
    {
      name: "dashframe:report-chart-tabs",
      storage: createJSONStorage(() => safeSessionStorage),
    },
  ),
);

/**
 * The tabs a report shows. The chart in the URL is always open. A saved chart
 * that no longer exists drops out once the charts have loaded (`chartIds` is
 * `null` until then); a new chart stays until it lands or is closed.
 */
export function resolveChartTabs(
  stored: readonly ChartTab[],
  urlChartId: string | null,
  chartIds: ReadonlySet<string> | null,
): ChartTab[] {
  const tabs = stored.flatMap((tab): ChartTab[] => {
    // A new chart whose chart exists already landed — the page reloaded
    // before the tab heard back. It is a saved chart now.
    if (tab.insightId !== undefined)
      return chartIds?.has(tab.id) ? [{ id: tab.id }] : [tab];
    return !chartIds || chartIds.has(tab.id) ? [tab] : [];
  });
  if (
    urlChartId &&
    !tabs.some((tab) => tab.id === urlChartId) &&
    chartIds?.has(urlChartId)
  ) {
    tabs.push({ id: urlChartId });
  }
  return tabs;
}

/**
 * New charts whose landing batch is in flight. Closing such a tab must not
 * discard its insight: the batch may commit first, and the delete would then
 * take the chart off the report with it.
 */
const landingChartIds = new Set<string>();

export const chartLanding = {
  start: (tabId: string) => landingChartIds.add(tabId),
  finish: (tabId: string) => landingChartIds.delete(tabId),
  isPending: (tabId: string) => landingChartIds.has(tabId),
};

/**
 * Which tab is open after closing `closingId`: the same one when another tab
 * closed, otherwise its right-hand neighbour, else its left, else the report
 * (`null`).
 */
export function tabAfterClose(
  tabs: readonly ChartTab[],
  closingId: string,
  activeId: string | null,
): string | null {
  if (closingId !== activeId) return activeId;
  const index = tabs.findIndex((tab) => tab.id === closingId);
  if (index === -1) return null;
  return tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null;
}

/**
 * A new chart goes on the report once it has something to plot: a field to
 * split by and a metric to measure. Before that it stays in its tab, so a
 * report never holds an empty tile.
 */
export function isReadyToLand(
  insight: Pick<Insight, "selectedFields" | "metrics">,
): boolean {
  return (
    insight.selectedFields.length > 0 && (insight.metrics ?? []).length > 0
  );
}

/** How many reports place this chart. */
export function countReportsUsingChart(
  reports: readonly Pick<Dashboard, "items">[],
  visualizationId: string,
): number {
  return reports.filter((report) =>
    report.items.some(
      (item) =>
        item.type === "visualization" &&
        item.visualizationId === visualizationId,
    ),
  ).length;
}

export function reportsUsingChartLabel(count: number): string {
  return `Used in ${count} report${count === 1 ? "" : "s"}`;
}

/**
 * Tab labels, in tab order. Two tabs with the same name are told apart by
 * number: "Untitled chart", "Untitled chart 2".
 */
export function disambiguateLabels(labels: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    return count === 1 ? label : `${label} ${count}`;
  });
}

/** The row just below a report's lowest tile. */
export function reportBottom(items: readonly DashboardItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.y + item.height), 0);
}

/**
 * Lands a new chart: its visualization, plotting the insight's first field
 * against its first metric, and its tile below the report's others — in one
 * batch, so the report never shows a tile without its chart.
 */
export function buildLandChartCommands(input: {
  chartId: string;
  report: Pick<Dashboard, "id" | "items">;
  insight: Pick<Insight, "id" | "selectedFields" | "metrics">;
  name: string;
  chartType?: VisualizationType;
}) {
  const { chartId, report, insight, name } = input;
  const field = insight.selectedFields[0];
  const metric = (insight.metrics ?? [])[0];
  if (!field || !metric) return [];
  return [
    cmd("CreateVisualization", {
      id: chartId as UUID,
      name,
      insightId: insight.id,
      visualizationType: input.chartType ?? "barY",
      spec: {},
      encoding: { x: fieldEncoding(field), y: metricEncoding(metric.id) },
    }),
    cmd("AddDashboardItem", {
      dashboardId: report.id,
      item: {
        id: crypto.randomUUID() as UUID,
        type: "visualization",
        visualizationId: chartId as UUID,
        x: 0,
        y: reportBottom(report.items),
        width: 6,
        height: 6,
      },
    }),
  ];
}
