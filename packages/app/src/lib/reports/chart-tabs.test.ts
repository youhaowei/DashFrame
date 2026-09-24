import type { DashboardItem, InsightMetric, UUID } from "@dashframe/types";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  buildLandChartCommands,
  countReportsUsingChart,
  disambiguateLabels,
  isReadyToLand,
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
