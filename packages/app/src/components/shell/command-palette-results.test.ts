import { describe, expect, it } from "vite-plus/test";

import {
  buildPaletteResults,
  RECENT_PER_KIND,
  type PaletteSources,
} from "./command-palette-results";

type Report = NonNullable<PaletteSources["reports"]>[number];
type Table = NonNullable<PaletteSources["dataTables"]>[number];
type Draft = NonNullable<PaletteSources["drafts"]>[number];

function report(
  id: string,
  name: string,
  chartIds: string[],
  updatedAt = 1,
): Report {
  return {
    id,
    name,
    createdAt: 0,
    updatedAt,
    items: chartIds.map((chartId, index) => ({
      id: `${id}-item-${index}`,
      type: "visualization" as const,
      visualizationId: chartId,
      x: 0,
      y: 0,
      width: 6,
      height: 6,
    })),
  } as Report;
}

function table(id: string, name: string, metricNames: string[] = []): Table {
  return {
    id,
    name,
    dataSourceId: "local",
    createdAt: 0,
    metrics: metricNames.map((metricName, index) => ({
      id: `${id}-metric-${index}`,
      name: metricName,
      tableId: id,
      aggregation: "sum",
    })),
  } as Table;
}

function draft(draftId: string, title: string, updatedAt: string): Draft {
  return {
    draftId,
    title,
    createdAt: updatedAt,
    updatedAt,
    commandCount: 2,
    kinds: {},
    paths: [],
    createdBy: "user",
  } as Draft;
}

const sources: PaletteSources = {
  reports: [report("weekly", "Weekly sales", ["by-category"], 5)],
  charts: [
    { id: "by-category", name: "Sum of Sales by Category", createdAt: 0 },
    { id: "loose", name: "Sales on no report", createdAt: 0 },
  ],
  dataSources: [{ id: "local", name: "Local Files", createdAt: 0 }],
  dataTables: [table("sales", "sales_data", ["Total sales"])],
  drafts: [draft("d1", "Rename sales_data", "2026-09-01T00:00:00.000Z")],
};

const labels = (groups: ReturnType<typeof buildPaletteResults>) =>
  groups.map((group) => [group.heading, group.items.map((item) => item.label)]);

describe("buildPaletteResults", () => {
  it("opens on actions first, then each kind", () => {
    expect(labels(buildPaletteResults(sources, ""))).toEqual([
      [
        "Actions",
        [
          "New report",
          "Add data source",
          "Go to Reports",
          "Go to Data sources",
          "Go to Drafts",
        ],
      ],
      ["Reports", ["Weekly sales"]],
      ["Charts", ["Sum of Sales by Category"]],
      ["Data sources and tables", ["Local Files", "sales_data"]],
      ["Saved metrics", ["Total sales"]],
      ["Drafts", ["Rename sales_data"]],
    ]);
  });

  it("shows only the most recently updated few of a kind on an empty query", () => {
    const reports = Array.from({ length: RECENT_PER_KIND + 2 }, (_, index) =>
      report(`r${index}`, `Report ${index}`, [], index),
    );
    const groups = buildPaletteResults({ reports }, "");
    const shown = groups.find((group) => group.id === "reports")!.items;
    expect(shown.map((item) => item.label)).toEqual([
      "Report 4",
      "Report 3",
      "Report 2",
    ]);
  });

  it("keeps the group order for a query and puts actions last", () => {
    const groups = buildPaletteResults(sources, "sales");
    expect(groups.map((group) => group.id)).toEqual([
      "reports",
      "charts",
      "data",
      "metrics",
      "drafts",
    ]);
    const withAction = buildPaletteResults(sources, "report");
    expect(withAction.at(-1)?.id).toBe("actions");
    expect(withAction[0]?.id).toBe("reports");
  });

  it("leaves out a chart that sits on no report", () => {
    const items = buildPaletteResults(sources, "sales").flatMap(
      (group) => group.items,
    );
    expect(items.map((item) => item.label)).not.toContain("Sales on no report");
    expect(items.find((item) => item.kind === "chart")?.target).toEqual({
      kind: "chart",
      reportId: "weekly",
      chartId: "by-category",
    });
  });

  it("opens a table and its saved metrics on the table's data source", () => {
    const items = buildPaletteResults(sources, "").flatMap(
      (group) => group.items,
    );
    const target = { kind: "data-source", sourceId: "local", tableId: "sales" };
    expect(items.find((item) => item.kind === "table")?.target).toEqual(target);
    expect(items.find((item) => item.kind === "metric")?.target).toEqual(
      target,
    );
  });

  it("narrows to actions after `>`", () => {
    expect(labels(buildPaletteResults(sources, ">"))).toEqual([
      [
        "Actions",
        [
          "New report",
          "Add data source",
          "Go to Reports",
          "Go to Data sources",
          "Go to Drafts",
        ],
      ],
    ]);
    // "sales" matches artifacts, but after `>` only actions are searched.
    expect(buildPaletteResults(sources, "> sales")).toEqual([]);
    expect(labels(buildPaletteResults(sources, ">new"))).toEqual([
      ["Actions", ["New report"]],
    ]);
  });

  it("still shows the other lists when one is missing", () => {
    const groups = buildPaletteResults(
      { ...sources, reports: undefined },
      "sales",
    );
    expect(groups.map((group) => group.id)).toEqual([
      "data",
      "metrics",
      "drafts",
    ]);
  });

  it("counts only a report's live charts, and leaves the count out when charts are unknown", () => {
    const withOrphan = report("r", "Mixed", [
      "by-category",
      "deleted",
      "by-category",
    ]);
    const detail = (charts: PaletteSources["charts"]) =>
      buildPaletteResults({ reports: [withOrphan], charts }, "").find(
        (group) => group.id === "reports",
      )!.items[0]!.detail;
    expect(detail(sources.charts)).toBe("1 chart");
    expect(detail(undefined)).toBeUndefined();
  });

  it("leaves a source's table count out while tables are unknown", () => {
    const source = (dataTables: PaletteSources["dataTables"]) =>
      buildPaletteResults({ dataSources: sources.dataSources, dataTables }, "")
        .flatMap((group) => group.items)
        .find((item) => item.kind === "data-source")!.detail;
    expect(source(sources.dataTables)).toBe("1 table");
    expect(source(undefined)).toBeUndefined();
  });
});
