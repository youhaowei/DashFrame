import {
  draftLabels,
  epoch,
  type DraftSummary,
} from "@/app/drafts/_components/draft-review";
import type {
  Dashboard,
  DataSource,
  DataTable,
  Visualization,
} from "@dashframe/types";
import { defaultFilter } from "cmdk";

/**
 * The command palette's results: what each workspace list contributes, how a
 * query narrows them, and the fixed order the groups keep. Pure, so the
 * palette component only renders and runs what this returns.
 */

export type PaletteActionId =
  | "new-report"
  | "add-data-source"
  | "go-reports"
  | "go-data-sources"
  | "go-drafts"
  | "go-settings";

/** Where picking a result goes, or what it runs. */
export type PaletteTarget =
  | { kind: "report"; reportId: string }
  | { kind: "chart"; reportId: string; chartId: string }
  | { kind: "data-source"; sourceId: string; tableId?: string }
  | { kind: "draft"; draftId: string }
  | { kind: "action"; action: PaletteActionId };

export type PaletteItemKind =
  | "report"
  | "chart"
  | "data-source"
  | "table"
  | "metric"
  | "draft"
  | "action";

export interface PaletteItem {
  /** Unique across the palette; also the cmdk item value. */
  id: string;
  kind: PaletteItemKind;
  label: string;
  /** Muted context on the right of the row. */
  detail?: string;
  /** Extra words a query may match without them appearing in copy. */
  keywords: string[];
  target: PaletteTarget;
}

export type PaletteGroupId =
  | "reports"
  | "charts"
  | "data"
  | "metrics"
  | "drafts"
  | "actions";

export interface PaletteGroup {
  id: PaletteGroupId;
  heading: string;
  items: PaletteItem[];
}

type WithUpdatedAt = { updatedAt?: number };

/** The workspace lists the palette indexes. A list still loading, or one that failed, is absent. */
export interface PaletteSources {
  reports?: readonly (Pick<Dashboard, "id" | "name" | "items" | "createdAt"> &
    WithUpdatedAt)[];
  charts?: readonly (Pick<Visualization, "id" | "name" | "createdAt"> &
    WithUpdatedAt)[];
  dataSources?: readonly (Pick<DataSource, "id" | "name" | "createdAt"> &
    WithUpdatedAt)[];
  dataTables?: readonly (Pick<
    DataTable,
    "id" | "name" | "dataSourceId" | "metrics" | "createdAt"
  > &
    WithUpdatedAt)[];
  drafts?: readonly DraftSummary[];
}

/** How many of each kind an empty query shows, most recently updated first. */
export const RECENT_PER_KIND = 3;

const GROUP_HEADINGS: Record<PaletteGroupId, string> = {
  reports: "Reports",
  charts: "Charts",
  data: "Data sources and tables",
  metrics: "Saved metrics",
  drafts: "Drafts",
  actions: "Actions",
};

/** With a query, actions come last; with none, first, so they are found without a prefix. */
const QUERY_ORDER: PaletteGroupId[] = [
  "reports",
  "charts",
  "data",
  "metrics",
  "drafts",
  "actions",
];
const EMPTY_ORDER: PaletteGroupId[] = [
  "actions",
  "reports",
  "charts",
  "data",
  "metrics",
  "drafts",
];

// Keywords stay few, here and on every result: cmdk's ranking is a fuzzy
// subsequence match, so each extra word lets more unrelated queries match.
const ACTIONS: PaletteItem[] = [
  action("new-report", "New report", ["create", "dashboard"]),
  action("add-data-source", "Add data source", ["import", "connect"]),
  action("go-reports", "Go to Reports", []),
  action("go-data-sources", "Go to Data sources", []),
  action("go-drafts", "Go to Drafts", []),
  action("go-settings", "Go to Settings", [
    "preferences",
    "appearance",
    "theme",
    "credentials",
  ]),
];

function action(
  id: PaletteActionId,
  label: string,
  keywords: string[],
): PaletteItem {
  return {
    id: `action:${id}`,
    kind: "action",
    label,
    keywords,
    target: { kind: "action", action: id },
  };
}

/**
 * A query that starts with `>` searches actions only; the rest of it is the
 * query. An unadvertised shortcut, so nothing in the palette names it.
 */
export function parsePaletteQuery(input: string): {
  actionsOnly: boolean;
  query: string;
} {
  const trimmed = input.trimStart();
  if (trimmed.startsWith(">")) {
    return { actionsOnly: true, query: trimmed.slice(1).trim() };
  }
  return { actionsOnly: false, query: input.trim() };
}

interface Ranked {
  item: PaletteItem;
  /** Newest first when there is no query. */
  recency: number;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function recencyOf(row: { createdAt: number } & WithUpdatedAt): number {
  return row.updatedAt ?? row.createdAt;
}

/** Every artifact result, by group, before a query narrows them. */
function artifactItems(
  sources: PaletteSources,
): Record<Exclude<PaletteGroupId, "actions">, Ranked[]> {
  const reports = sources.reports ?? [];
  const tables = sources.dataTables ?? [];
  const sourceNames = new Map(
    (sources.dataSources ?? []).map((source) => [source.id, source.name]),
  );

  // A chart is reached through a report; one on no report is left out, so
  // opening a result never has to place it (a write). A chart on several
  // reports opens on the one updated most recently.
  const reportByChart = new Map<string, (typeof reports)[number]>();
  for (const report of reports.toSorted(
    (a, b) => recencyOf(b) - recencyOf(a),
  )) {
    for (const item of report.items) {
      if (item.type !== "visualization" || !item.visualizationId) continue;
      if (!reportByChart.has(item.visualizationId)) {
        reportByChart.set(item.visualizationId, report);
      }
    }
  }

  // Count charts the way the report list does (lib/reports/report-contents):
  // only tiles whose chart still exists, each chart once. Without the chart
  // list the count is unknown, so it is left out rather than shown as 0.
  const liveChartIds = sources.charts
    ? new Set(sources.charts.map((chart) => chart.id))
    : undefined;
  const reportItems = reports.map((report) => {
    const chartCount = liveChartIds
      ? new Set(
          report.items.flatMap((item) =>
            item.type === "visualization" &&
            item.visualizationId &&
            liveChartIds.has(item.visualizationId)
              ? [item.visualizationId]
              : [],
          ),
        ).size
      : undefined;
    return {
      item: {
        id: `report:${report.id}`,
        kind: "report" as const,
        label: report.name || "Untitled report",
        detail:
          chartCount === undefined
            ? undefined
            : plural(chartCount, "chart", "charts"),
        keywords: ["report"],
        target: { kind: "report" as const, reportId: report.id },
      },
      recency: recencyOf(report),
    };
  });

  const chartItems = (sources.charts ?? []).flatMap((chart) => {
    const report = reportByChart.get(chart.id);
    if (!report) return [];
    const reportName = report.name || "Untitled report";
    return [
      {
        item: {
          id: `chart:${chart.id}`,
          kind: "chart" as const,
          label: chart.name || "Untitled chart",
          detail: `On ${reportName}`,
          keywords: ["chart"],
          target: {
            kind: "chart" as const,
            reportId: report.id,
            chartId: chart.id,
          },
        },
        recency: recencyOf(chart),
      },
    ];
  });

  const tableCounts = new Map<string, number>();
  for (const table of tables) {
    tableCounts.set(
      table.dataSourceId,
      (tableCounts.get(table.dataSourceId) ?? 0) + 1,
    );
  }
  const sourceItems = (sources.dataSources ?? []).map((source) => ({
    item: {
      id: `data-source:${source.id}`,
      kind: "data-source" as const,
      label: source.name,
      // Unknown while the table list is loading or failed, not 0.
      detail: sources.dataTables
        ? plural(tableCounts.get(source.id) ?? 0, "table", "tables")
        : undefined,
      keywords: ["data source"],
      target: { kind: "data-source" as const, sourceId: source.id },
    },
    recency: recencyOf(source),
  }));
  const tableItems = tables.map((table) => {
    const sourceName = sourceNames.get(table.dataSourceId);
    return {
      item: {
        id: `table:${table.id}`,
        kind: "table" as const,
        label: table.name,
        detail: sourceName ? `Table in ${sourceName}` : "Table",
        keywords: ["table"],
        target: {
          kind: "data-source" as const,
          sourceId: table.dataSourceId,
          tableId: table.id,
        },
      },
      recency: recencyOf(table),
    };
  });

  // A saved metric has no page of its own; it opens on its table. It has no
  // timestamp either, so it takes its table's.
  const metricItems = tables.flatMap((table) =>
    (table.metrics ?? []).map((metric) => ({
      item: {
        id: `metric:${table.id}:${metric.id}`,
        kind: "metric" as const,
        label: metric.name,
        detail: `On ${table.name}`,
        keywords: ["metric"],
        target: {
          kind: "data-source" as const,
          sourceId: table.dataSourceId,
          tableId: table.id,
        },
      },
      recency: recencyOf(table),
    })),
  );

  const drafts = sources.drafts ?? [];
  const labels = draftLabels([...drafts]);
  const draftItems = drafts.map((draft) => ({
    item: {
      id: `draft:${draft.draftId}`,
      kind: "draft" as const,
      label: labels.get(draft.draftId) ?? "Empty draft",
      detail: plural(draft.commandCount, "change", "changes"),
      keywords: ["draft"],
      target: { kind: "draft" as const, draftId: draft.draftId },
    },
    recency: epoch(draft.updatedAt ?? draft.createdAt),
  }));

  return {
    reports: reportItems,
    charts: chartItems,
    // Newest first per kind; an empty query shows a few sources, then a few
    // tables. A query re-ranks the whole group by match.
    data: [...byRecency(sourceItems), ...byRecency(tableItems)],
    metrics: metricItems,
    drafts: draftItems,
  };
}

function byRecency(items: Ranked[]): Ranked[] {
  return items.toSorted((a, b) => b.recency - a.recency);
}

function recent(items: Ranked[]): PaletteItem[] {
  return byRecency(items)
    .slice(0, RECENT_PER_KIND)
    .map((ranked) => ranked.item);
}

/** cmdk's default ranking, kept inside each group so the group order stays fixed. */
function matching(items: readonly PaletteItem[], query: string): PaletteItem[] {
  return items
    .map((item) => ({
      item,
      score: defaultFilter(item.label, query, item.keywords),
    }))
    .filter((scored) => scored.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .map((scored) => scored.item);
}

/**
 * The palette's groups for `input`, in display order, without empty groups.
 *
 * - No query: actions, then the few most recently updated of each kind.
 * - A query: every match, ranked within its group; actions last.
 * - `>` first: actions only, matched on the rest of the input.
 */
export function buildPaletteResults(
  sources: PaletteSources,
  input: string,
): PaletteGroup[] {
  const { actionsOnly, query } = parsePaletteQuery(input);
  if (actionsOnly) {
    const items = query ? matching(ACTIONS, query) : ACTIONS;
    return items.length
      ? [{ id: "actions", heading: GROUP_HEADINGS.actions, items }]
      : [];
  }

  const artifacts = artifactItems(sources);
  const itemsFor = (id: PaletteGroupId): PaletteItem[] => {
    if (id === "actions") return query ? matching(ACTIONS, query) : ACTIONS;
    const group = artifacts[id];
    if (!query) {
      // Sources and tables are two kinds sharing one group: a few of each.
      if (id === "data") {
        const [sources, tables] = partition(group, "data-source");
        return [...recent(sources), ...recent(tables)];
      }
      return recent(group);
    }
    return matching(
      group.map((ranked) => ranked.item),
      query,
    );
  };

  return (query ? QUERY_ORDER : EMPTY_ORDER)
    .map((id) => ({ id, heading: GROUP_HEADINGS[id], items: itemsFor(id) }))
    .filter((group) => group.items.length > 0);
}

function partition(
  items: Ranked[],
  kind: PaletteItemKind,
): [Ranked[], Ranked[]] {
  const yes: Ranked[] = [];
  const no: Ranked[] = [];
  for (const ranked of items)
    (ranked.item.kind === kind ? yes : no).push(ranked);
  return [yes, no];
}
