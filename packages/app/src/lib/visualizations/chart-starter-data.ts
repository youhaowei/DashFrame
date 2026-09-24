import { requestHost } from "@/data/host";
import { formatCellValue } from "@/lib/cell-formatter";
import { queryDataFrame } from "@/lib/data-access/data-frames";
import type {
  Insight,
  InsightFetchDefinition,
  InsightMetric,
  UUID,
} from "@dashframe/types";
import { useEffect, useState } from "react";
import {
  chartStarterGroupLimit,
  type ChartStarterSuggestion,
} from "./chart-starter";

export interface ChartStarterPoint {
  label: string;
  value: number;
}

export interface ChartStarterAggregate {
  points: ChartStarterPoint[];
  /** How many groups the aggregate has: the bars or dates the chart would draw. */
  groups: number;
}

/** The host's largest page; a line reads its dates a page at a time. */
const PAGE_SIZE = 500;
/** A bar card draws its first (or largest) groups. */
const BAR_POINTS = 12;

/**
 * Aggregates behind the starter cards, one query per card and cached per
 * table generation: reopening a new chart on the same table asks nothing.
 * A failed query is dropped from the cache so the next mount retries it.
 */
const cache = new Map<string, Promise<ChartStarterAggregate>>();

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return Number(value ?? 0);
}

/**
 * One card's aggregate: the suggestion's metric grouped by its field. A line
 * reads every date (up to its rule's limit, so the thumbnail is the whole
 * series, never a prefix of it); a bar reads its first twelve groups, largest
 * first for a sorted bar. `groups` is the true group count, which the sampled
 * rules can only estimate.
 */
export async function fetchChartStarterAggregate(
  insight: Pick<Insight, "source" | "filters" | "joins">,
  suggestion: ChartStarterSuggestion,
): Promise<ChartStarterAggregate> {
  const metric: InsightMetric = {
    id: crypto.randomUUID() as UUID,
    name: "value",
    sourceTable: suggestion.group.tableId,
    columnName: suggestion.measure?.columnName,
    aggregation: suggestion.aggregation,
  };
  const definition: InsightFetchDefinition = {
    baseTableId: insight.source.sourceId,
    selectedFields: [suggestion.group.id],
    metrics: [metric],
    filters: insight.filters,
    joins: insight.joins,
  };
  // A presentation makes the host read the table's published data instead of
  // pulling the source again (see createInsightMaterializer), so a card never costs
  // a live connector fetch.
  const result = await requestHost("fetchData", {
    insight: definition,
    presentation: { dimensions: [suggestion.group.id] },
  });
  if (result.status === "failed") throw new Error(result.message);
  // The row count or sum is the metric column; the other one is the group.
  const columns = result.schema.filter(
    (column) => column.id !== "__report_grouping",
  );
  const metricColumn =
    columns.find((column) => column.id.startsWith("metric_")) ?? columns[1];
  const groupColumn = columns.find((column) => column !== metricColumn);
  if (!metricColumn || !groupColumn)
    throw new Error("The aggregate has no value column.");

  const isLine = suggestion.chartType === "line";
  const sort = [
    suggestion.sortByValue && !isLine
      ? { fieldId: metricColumn.id, direction: "desc" as const }
      : { fieldId: groupColumn.id, direction: "asc" as const },
  ];
  const limit = chartStarterGroupLimit(suggestion.rule);
  const rows: Record<string, unknown>[] = [];
  let groups = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await queryDataFrame(result.dataFrameId, {
      offset,
      limit: isLine ? PAGE_SIZE : BAR_POINTS,
      sort,
    });
    if (page.status === "failed") throw new Error(page.message);
    rows.push(...page.rows);
    groups = page.totalCount;
    const more = offset + page.rows.length < groups;
    if (!isLine || !more || groups > limit || page.rows.length === 0) break;
  }
  return {
    groups,
    points: rows.map((row) => ({
      label: formatCellValue(row[groupColumn.id], suggestion.group.type),
      value: toNumber(row[metricColumn.id]),
    })),
  };
}

export type ChartStarterPointsState =
  | { status: "loading" }
  | { status: "ready"; points: ChartStarterPoint[] }
  /** More groups than the rule allows: the sample undercounted them. */
  | { status: "unfit" }
  | { status: "failed" };

/**
 * The points one starter card draws. `revision` names the table generation
 * (see `buildInsightSourceRevision`), so a refreshed table queries again.
 */
export function useChartStarterPoints(
  insight: Pick<Insight, "source" | "filters" | "joins">,
  suggestion: ChartStarterSuggestion,
  revision: string,
): ChartStarterPointsState {
  const key = JSON.stringify([
    revision,
    suggestion.key,
    insight.filters ?? [],
    insight.joins ?? [],
  ]);
  const [state, setState] = useState<{
    key: string;
    value: ChartStarterPointsState;
  }>({ key, value: { status: "loading" } });

  useEffect(() => {
    let live = true;
    let pending = cache.get(key);
    if (!pending) {
      pending = fetchChartStarterAggregate(insight, suggestion);
      cache.set(key, pending);
      pending.catch(() => {
        if (cache.get(key) === pending) cache.delete(key);
      });
    }
    pending.then(
      ({ points, groups }) => {
        if (!live) return;
        setState({
          key,
          value:
            groups > chartStarterGroupLimit(suggestion.rule)
              ? { status: "unfit" }
              : { status: "ready", points },
        });
      },
      () => {
        if (live) setState({ key, value: { status: "failed" } });
      },
    );
    return () => {
      live = false;
    };
    // The key covers everything the query reads.
    // oxlint-disable-next-line react-hooks-js/exhaustive-deps -- key is the structural dependency.
  }, [key]);

  return state.key === key ? state.value : { status: "loading" };
}
