import type { DashboardItem, InsightMetric, UUID } from "@dashframe/types";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  buildLandChartCommands,
  countReportsUsingChart,
  deleteChartDescription,
  disambiguateLabels,
  isReadyToLand,
  planChartDeletion,
  reconcileNewChartTab,
  resolveChartTabs,
  tabAfterClose,
  useReportChartTabs,
} from "./chart-tabs";

const FIELD = "10000000-0000-4000-8000-000000000001" as UUID;
const METRIC: InsightMetric = {
  id: "10000000-0000-4000-8000-000000000002" as UUID,
  name: "Total revenue",
  sourceTable: "10000000-0000-4000-8000-000000000003" as UUID,
  columnName: "revenue",
  aggregation: "sum",
};

function tile(visualizationId: string, y = 0, height = 6): DashboardItem {
  return {
    id: `item-${visualizationId}` as UUID,
    type: "visualization",
    visualizationId: visualizationId as UUID,
    x: 0,
    y,
    width: 6,
    height,
  };
}

describe("resolveChartTabs", () => {
  it("always opens the chart named in the URL", () => {
    expect(resolveChartTabs([{ id: "a" }], "b", new Set(["a", "b"]))).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });

  it("drops a saved chart that is gone, once the charts have loaded", () => {
    const stored = [{ id: "gone" }, { id: "kept" }];
    expect(resolveChartTabs(stored, null, null)).toEqual(stored);
    expect(resolveChartTabs(stored, "gone", new Set(["kept"]))).toEqual([
      { id: "kept" },
    ]);
  });

  it("keeps a new chart, which has no saved chart yet", () => {
    const fresh = { id: "new-1", insightId: "insight-1" };
    expect(resolveChartTabs([fresh], "new-1", new Set())).toEqual([fresh]);
  });

  it("treats a new chart whose chart exists as landed, after a reload mid-landing", () => {
    const fresh = { id: "new-1", insightId: "insight-1" };
    expect(resolveChartTabs([fresh], "new-1", new Set(["new-1"]))).toEqual([
      { id: "new-1" },
    ]);
  });
});

describe("reconcileNewChartTab", () => {
  const tab = { id: "new-1", insightId: "insight-1" };
  const loaded = {
    insightIds: new Set(["insight-1"]),
    visualizations: [] as { id: string; insightId: string }[],
    creating: false,
    landing: false,
  };

  it("decides nothing from a list that has not loaded, or mid-write", () => {
    const closing = { ...tab, closing: true as const };
    expect(
      reconcileNewChartTab(closing, { ...loaded, visualizations: null }),
    ).toBe("wait");
    expect(reconcileNewChartTab(closing, { ...loaded, landing: true })).toBe(
      "wait",
    );
    const creating = { ...tab, creating: true as const };
    expect(
      reconcileNewChartTab(creating, { ...loaded, insightIds: null }),
    ).toBe("wait");
    expect(
      reconcileNewChartTab(creating, {
        ...loaded,
        insightIds: new Set(),
        creating: true,
      }),
    ).toBe("wait");
  });

  it("settles a create from whether the insight is listed", () => {
    const creating = { ...tab, creating: true as const };
    expect(reconcileNewChartTab(creating, loaded)).toBe("created");
    expect(
      reconcileNewChartTab(creating, { ...loaded, insightIds: new Set() }),
    ).toBe("remove");
  });

  it("discards a closed chart only when nothing is built on its insight", () => {
    const closing = { ...tab, closing: true as const };
    expect(reconcileNewChartTab(closing, loaded)).toBe("discard");
    expect(
      reconcileNewChartTab(closing, {
        ...loaded,
        visualizations: [{ id: "other", insightId: "insight-1" }],
      }),
    ).toBe("remove");
  });

  it("drops a closed chart whose insight is already gone, and never guesses", () => {
    const closing = { ...tab, closing: true as const };
    expect(
      reconcileNewChartTab(closing, { ...loaded, insightIds: new Set() }),
    ).toBe("remove");
    expect(reconcileNewChartTab(closing, { ...loaded, insightIds: null })).toBe(
      "wait",
    );
  });

  it("turns an open tab whose chart landed into a saved chart", () => {
    expect(
      reconcileNewChartTab(tab, {
        ...loaded,
        visualizations: [{ id: "new-1", insightId: "insight-1" }],
      }),
    ).toBe("landed");
    expect(reconcileNewChartTab(tab, loaded)).toBe("wait");
  });
});

describe("tabAfterClose", () => {
  const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("keeps the open tab when another one closes", () => {
    expect(tabAfterClose(tabs, "a", "c")).toBe("c");
    expect(tabAfterClose(tabs, "a", null)).toBeNull();
  });

  it("opens the right-hand neighbour, else the left, else the report", () => {
    expect(tabAfterClose(tabs, "b", "b")).toBe("c");
    expect(tabAfterClose(tabs, "c", "c")).toBe("b");
    expect(tabAfterClose([{ id: "a" }], "a", "a")).toBeNull();
  });
});

describe("isReadyToLand", () => {
  it("waits for both a field and a metric", () => {
    expect(isReadyToLand({ selectedFields: [], metrics: [] })).toBe(false);
    expect(isReadyToLand({ selectedFields: [FIELD], metrics: [] })).toBe(false);
    expect(isReadyToLand({ selectedFields: [], metrics: [METRIC] })).toBe(
      false,
    );
    expect(isReadyToLand({ selectedFields: [FIELD], metrics: [METRIC] })).toBe(
      true,
    );
  });
});

describe("buildLandChartCommands", () => {
  const report = {
    id: "report-1" as UUID,
    items: [tile("other", 0, 4), tile("lowest", 4, 6)],
  };

  it("creates the chart under the tab's id and places it below every tile, in one batch", () => {
    const commands = buildLandChartCommands({
      chartId: "chart-1",
      report,
      insight: {
        id: "insight-1" as UUID,
        selectedFields: [FIELD],
        metrics: [METRIC],
      },
      name: "Total revenue by region",
    });

    expect(commands.map((command) => command.path)).toEqual([
      "createVisualizationCmd",
      "addDashboardItemCmd",
    ]);
    expect(commands[0]!.args).toMatchObject({
      id: "chart-1",
      insightId: "insight-1",
      name: "Total revenue by region",
      visualizationType: "barY",
      encoding: { x: `field:${FIELD}`, y: `metric:${METRIC.id}` },
    });
    expect(commands[1]!.args).toMatchObject({
      dashboardId: "report-1",
      item: { type: "visualization", visualizationId: "chart-1", y: 10 },
    });
  });

  it("puts a horizontal bar's groups on the vertical axis", () => {
    const [create] = buildLandChartCommands({
      chartId: "chart-1",
      report,
      insight: {
        id: "insight-1" as UUID,
        selectedFields: [FIELD],
        metrics: [METRIC],
      },
      name: "Total revenue by region",
      chartType: "barX",
    });
    expect(create!.args).toMatchObject({
      visualizationType: "barX",
      encoding: { x: `metric:${METRIC.id}`, y: `field:${FIELD}` },
    });
  });

  it("builds nothing for a chart with nothing to plot", () => {
    expect(
      buildLandChartCommands({
        chartId: "chart-1",
        report,
        insight: { id: "insight-1" as UUID, selectedFields: [], metrics: [] },
        name: "Untitled",
      }),
    ).toEqual([]);
  });
});

describe("countReportsUsingChart", () => {
  it("counts reports, not tiles", () => {
    const reports = [
      { items: [tile("chart-1"), { ...tile("chart-1"), id: "twice" as UUID }] },
      { items: [tile("chart-2")] },
      { items: [tile("chart-1")] },
    ];
    expect(countReportsUsingChart(reports, "chart-1")).toBe(2);
    expect(countReportsUsingChart(reports, "chart-3")).toBe(0);
  });
});

describe("planChartDeletion", () => {
  const CHART = { id: "chart-1" as UUID, insightId: "insight-1" as UUID };
  const chartOn = (id: string, insightId: string) => ({
    id: id as UUID,
    insightId: insightId as UUID,
  });
  const insightOn = (
    id: string,
    sourceId = "table-1",
    sourceType = "dataTable",
  ) =>
    ({ id, source: { sourceType, sourceId } }) as Parameters<
      typeof planChartDeletion
    >[0]["insights"][number];
  const report = (id: string, items: DashboardItem[]) => ({
    id: id as UUID,
    items,
  });
  const deleteNode = (id: string) => ({ path: "deleteNode", args: { id } });
  const deleteIfUnused = (id: string) => ({
    path: "deleteNode",
    args: { id, ifUnused: true },
  });
  const reports = [
    report("report-1", [
      tile("chart-1"),
      { ...tile("chart-1"), id: "item-fanned-out" as UUID },
      tile("chart-2"),
    ]),
    report("report-2", [tile("chart-2")]),
    report("report-3", [tile("chart-1")]),
  ];

  it("deletes the chart and, if still unused at commit, its insight; the server removes the tiles", () => {
    const deletion = planChartDeletion({
      chart: CHART,
      reportId: "report-1",
      reports,
      visualizations: [CHART, chartOn("chart-2", "insight-2")],
      insights: [insightOn("insight-1"), insightOn("insight-2")],
    });

    expect(deletion.commands).toEqual([
      deleteNode("chart-1"),
      deleteIfUnused("insight-1"),
    ]);
    expect(deletion).toMatchObject({
      reportCount: 2,
      onThisReport: true,
      deletesInsight: true,
    });
  });

  it("keeps an insight another chart plots", () => {
    const deletion = planChartDeletion({
      chart: CHART,
      reportId: "report-2",
      reports,
      visualizations: [CHART, chartOn("chart-2", "insight-1")],
      insights: [insightOn("insight-1")],
    });

    expect(deletion.commands).toEqual([deleteNode("chart-1")]);
    expect(deletion).toMatchObject({
      reportCount: 2,
      onThisReport: false,
      deletesInsight: false,
    });
  });

  it("keeps an insight another insight reads from", () => {
    const deletion = planChartDeletion({
      chart: CHART,
      reportId: "report-1",
      reports: [],
      visualizations: [CHART],
      insights: [
        insightOn("insight-1"),
        insightOn("insight-2", "insight-1", "insight"),
      ],
    });

    expect(deletion.commands).toEqual([deleteNode("chart-1")]);
    expect(deletion.deletesInsight).toBe(false);
  });

  it("does not delete an insight that is not listed", () => {
    const deletion = planChartDeletion({
      chart: CHART,
      reportId: "report-1",
      reports: [],
      visualizations: [CHART],
      insights: [],
    });

    expect(deletion.commands).toEqual([deleteNode("chart-1")]);
  });

  it("stays two commands however many tiles the chart has", () => {
    const deletion = planChartDeletion({
      chart: CHART,
      reportId: "report-1",
      reports: [
        report(
          "report-1",
          Array.from({ length: 500 }, (_, index) => ({
            ...tile("chart-1"),
            id: `item-${index}` as UUID,
          })),
        ),
      ],
      visualizations: [CHART],
      insights: [insightOn("insight-1")],
    });

    expect(deletion.commands).toHaveLength(2);
    expect(deletion).toMatchObject({ reportCount: 1, onThisReport: true });
  });
});

describe("deleteChartDescription", () => {
  const describeDeletion = (
    reportCount: number,
    onThisReport: boolean,
    deletesInsight = false,
  ) =>
    deleteChartDescription("Revenue by region", {
      reportCount,
      onThisReport,
      deletesInsight,
    });

  it("says which reports lose the chart", () => {
    expect(describeDeletion(1, true)).toBe(
      'Are you sure you want to delete "Revenue by region"? It will be removed from this report. This action cannot be undone.',
    );
    expect(describeDeletion(3, true)).toContain(
      "It will be removed from 3 reports, including this one.",
    );
    expect(describeDeletion(1, false)).toContain(
      "It will be removed from 1 other report.",
    );
    expect(describeDeletion(2, false)).toContain(
      "It will be removed from 2 other reports.",
    );
    expect(describeDeletion(0, false)).toBe(
      'Are you sure you want to delete "Revenue by region"? This action cannot be undone.',
    );
  });

  it("says when the insight goes with the chart", () => {
    expect(describeDeletion(1, true, true)).toBe(
      'Are you sure you want to delete "Revenue by region"? It will be removed from this report. Its insight will be deleted with it. This action cannot be undone.',
    );
  });
});

describe("disambiguateLabels", () => {
  it("numbers repeated names in tab order", () => {
    expect(
      disambiguateLabels(["Untitled chart", "Revenue", "Untitled chart"]),
    ).toEqual(["Untitled chart", "Revenue", "Untitled chart 2"]);
  });
});

describe("useReportChartTabs", () => {
  beforeEach(() => useReportChartTabs.setState({ tabsByReport: {} }));

  it("keeps each report's tabs apart and opens a chart once", () => {
    const { open } = useReportChartTabs.getState();
    open("report-1", { id: "a" });
    open("report-1", { id: "a" });
    open("report-2", { id: "b" });
    expect(useReportChartTabs.getState().tabsByReport).toEqual({
      "report-1": [{ id: "a" }],
      "report-2": [{ id: "b" }],
    });
  });

  it("keeps a new chart's picked type through a reload, and drops it on landing", async () => {
    const { open, setChartType } = useReportChartTabs.getState();
    open("report-1", { id: "new", insightId: "insight-1" });
    setChartType("report-1", "new", "line");

    // A reload starts from empty module state and restores the tabs from
    // session storage.
    const KEY = "dashframe:report-chart-tabs";
    const saved = sessionStorage.getItem(KEY);
    expect(saved).toContain('"chartType":"line"');
    useReportChartTabs.setState({ tabsByReport: {} });
    sessionStorage.setItem(KEY, saved!);
    await useReportChartTabs.persist.rehydrate();
    expect(useReportChartTabs.getState().tabsByReport["report-1"]).toEqual([
      { id: "new", insightId: "insight-1", chartType: "line" },
    ]);

    useReportChartTabs.getState().setChartType("report-1", "new", undefined);
    expect(useReportChartTabs.getState().tabsByReport["report-1"]).toEqual([
      { id: "new", insightId: "insight-1" },
    ]);
    useReportChartTabs.getState().setChartType("report-1", "new", "barX");
    useReportChartTabs.getState().land("report-1", "new");
    expect(useReportChartTabs.getState().tabsByReport["report-1"]).toEqual([
      { id: "new" },
    ]);
  });

  it("turns a landed new chart into a saved one in place", () => {
    const { open, land, close } = useReportChartTabs.getState();
    open("report-1", { id: "a" });
    open("report-1", { id: "new", insightId: "insight-1" });
    land("report-1", "new");
    expect(useReportChartTabs.getState().tabsByReport["report-1"]).toEqual([
      { id: "a" },
      { id: "new" },
    ]);
    close("report-1", "a");
    expect(useReportChartTabs.getState().tabsByReport["report-1"]).toEqual([
      { id: "new" },
    ]);
  });
});
