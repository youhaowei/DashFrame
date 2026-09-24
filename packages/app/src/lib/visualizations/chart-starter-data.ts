import { requestHost } from "@/data/host";
import { formatCellValue } from "@/lib/cell-formatter";
import { metricIdToColumnAlias } from "@dashframe/engine";
import { queryDataFrame, removeDataFrame } from "@/lib/data-access/data-frames";
import type {
  Insight,
  InsightFetchDefinition,
  InsightMetric,
  InsightReporting,
  UUID,
} from "@dashframe/types";
import { useCallback, useEffect, useState } from "react";
import {
  chartStarterGroupLimit,
  type ChartStarterSuggestion,
} from "./chart-starter";

export interface ChartStarterPoint {
  label: string;
  /** Null where the aggregate has no value (all-null input, or a measure
   * its contract suppresses); the chart draws no mark there. */
  value: number | null;
}

export interface ChartStarterAggregate {
  points: ChartStarterPoint[];
  /** How many groups the aggregate has: the bars or dates the chart would draw. */
  groups: number;
}

/** What a card's query reads from the insight. */
type StarterQueryInsight = Pick<
  Insight,
  "source" | "filters" | "joins" | "reporting"
>;

/** The host's largest page; a line reads its dates a page at a time. */
const PAGE_SIZE = 500;
/** A bar card draws its first (or largest) groups. */
const BAR_POINTS = 12;

/** How many card aggregates stay cached: a few tables' worth of cards. */
export const CHART_STARTER_CACHE_LIMIT = 32;

/**
 * Aggregates behind the starter cards, one query per card, cached by table
 * generation so reopening a new chart on the same table asks nothing. Least
 * recently used entries go first once the cache is full; a failed query is
 * dropped so it can be asked again.
 */
const cache = new Map<string, Promise<ChartStarterAggregate>>();

function cached(
  key: string,
  load: () => Promise<ChartStarterAggregate>,
): Promise<ChartStarterAggregate> {
  let pending = cache.get(key);
  if (pending) {
    // Most recently used moves to the end of the insertion order.
    cache.delete(key);
  } else {
    pending = load();
    const settled = pending;
    settled.catch(() => {
      if (cache.get(key) === settled) cache.delete(key);
    });
  }
  cache.set(key, pending);
  while (cache.size > CHART_STARTER_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return pending;
}

/**
 * The reporting settings that narrow which rows the chart shows: its date
 * range and its row limit. The rest name the insight's own measures and
 * fields (measureIds, topN, dateGrains, pivotFields) or add rows and columns
 * (totals, comparison), none of which fit a one-metric thumbnail.
 */
function starterReporting(
  reporting: InsightReporting | undefined,
): InsightReporting | undefined {
  if (!reporting) return undefined;
  const { dateRange, limit } = reporting;
  if (dateRange === undefined && limit === undefined) return undefined;
  return {
    ...(dateRange !== undefined ? { dateRange } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function toValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * One card's aggregate: the suggestion's metric grouped by its field. A line
 * reads every date (up to its rule's limit, so the thumbnail is the whole
 * series, never a prefix of it); a bar reads its first twelve groups, largest
 * first for a sorted bar. `groups` is the true group count, which the sampled
 * rules can only estimate.
 */
export async function fetchChartStarterAggregate(
  insight: StarterQueryInsight,
  suggestion: ChartStarterSuggestion,
  /** The metric a pick would save, so the preview computes the same value. */
  metric: InsightMetric,
): Promise<ChartStarterAggregate> {
  const definition: InsightFetchDefinition = {
    baseTableId: insight.source.sourceId,
    selectedFields: [suggestion.group.id],
    metrics: [metric],
    filters: insight.filters,
    joins: insight.joins,
    reporting: starterReporting(insight.reporting),
    // A sorted bar saves a largest-first sort; with a row limit it decides
    // which groups the chart keeps, so the preview keeps the same ones.
    ...(suggestion.sortByValue
      ? {
          sorts: [
            {
              field: metricIdToColumnAlias(metric.id),
              direction: "desc" as const,
            },
          ],
        }
      : {}),
  };
  // A presentation makes the host read the table's published data instead of
  // pulling the source again (see createInsightMaterializer), so a card never costs
  // a live connector fetch.
  const result = await requestHost("fetchData", {
    insight: definition,
    presentation: { dimensions: [suggestion.group.id] },
    // Skip the host's coalescing and short replay, so no other request can
    // receive this frame and removing it after the read is safe.
    exclusive: true,
  });
  if (result.status === "failed") throw new Error(result.message);
  try {
    return await readAggregate(result, suggestion);
  } finally {
    // The frame is this card's alone (exclusive); remove it once read so
    // thumbnails never pile up in the workspace's frame list.
    removeFrame(result.dataFrameId);
  }
}

/** Removals retried after a failure, by frame id: how many tries failed. */
const failedRemovals = new Map<string, number>();
const removing = new Set<string>();
/** Tries per frame before giving up; startup retires leftovers anyway. */
const REMOVAL_ATTEMPTS = 3;

function removeFrame(id: string): void {
  // Each read is also a cleanup pass: frames whose removal failed go again.
  for (const pending of [id, ...failedRemovals.keys()]) {
    if (removing.has(pending)) continue;
    removing.add(pending);
    removeDataFrame(pending as UUID)
      .then(
        () => failedRemovals.delete(pending),
        (error: unknown) => {
          const attempts = (failedRemovals.get(pending) ?? 0) + 1;
          if (attempts < REMOVAL_ATTEMPTS)
            failedRemovals.set(pending, attempts);
          else {
            failedRemovals.delete(pending);
            console.warn(
              "[chart-starter] removing a thumbnail frame failed",
              error,
            );
          }
        },
      )
      .finally(() => removing.delete(pending));
  }
}

async function readAggregate(
  result: {
    dataFrameId: string;
    schema: readonly { id: string }[];
  },
  suggestion: ChartStarterSuggestion,
): Promise<ChartStarterAggregate> {
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
    const page = await queryDataFrame(result.dataFrameId as UUID, {
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
      value: toValue(row[metricColumn.id]),
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
/**
 * Group counts by grouping field and table generation. The count does not
 * depend on the metric, so the first card to query a field answers for every
 * other card grouped by it: a field with too many groups costs one query, not
 * one per metric. Bounded like the aggregate cache.
 */
const groupCounts = new Map<string, Promise<number>>();

function rememberGroupCount(
  key: string,
  pending: Promise<ChartStarterAggregate>,
) {
  if (groupCounts.has(key)) return;
  const count = pending.then(({ groups }) => groups);
  count.catch(() => {
    if (groupCounts.get(key) === count) groupCounts.delete(key);
  });
  groupCounts.set(key, count);
  while (groupCounts.size > CHART_STARTER_CACHE_LIMIT) {
    const oldest = groupCounts.keys().next().value;
    if (oldest === undefined) break;
    groupCounts.delete(oldest);
  }
}

async function loadChartStarterAggregate(
  key: string,
  countKey: string,
  insight: StarterQueryInsight,
  suggestion: ChartStarterSuggestion,
  metric: InsightMetric,
): Promise<ChartStarterAggregate> {
  const known = groupCounts.get(countKey);
  if (known) {
    const groups = await known.catch(() => undefined);
    // Too many groups for this rule: no need to ask for this metric's values.
    if (
      groups !== undefined &&
      groups > chartStarterGroupLimit(suggestion.rule)
    )
      return { points: [], groups };
  }
  return cached(key, () => {
    const pending = fetchChartStarterAggregate(insight, suggestion, metric);
    rememberGroupCount(countKey, pending);
    return pending;
  });
}

/**
 * Whether the points draw anything: a bar needs one value, a line two. A card
 * that would draw nothing makes way for the next candidate, as does the
 * chart it would land, which would be blank too.
 */
function drawable(
  suggestion: ChartStarterSuggestion,
  points: readonly ChartStarterPoint[],
): boolean {
  const values = points.filter((point) => point.value !== null).length;
  return values >= (suggestion.chartType === "line" ? 2 : 1);
}

export function useChartStarterPoints(
  insight: StarterQueryInsight,
  suggestion: ChartStarterSuggestion,
  revision: string,
  metric: InsightMetric,
): ChartStarterPointsState & { retry: () => void } {
  const { id: _metricId, ...metricDefinition } = metric;
  const scope = [
    insight.filters ?? [],
    insight.joins ?? [],
    starterReporting(insight.reporting) ?? null,
  ];
  const key = JSON.stringify([
    revision,
    suggestion.key,
    metricDefinition,
    suggestion.sortByValue,
    ...scope,
  ]);
  const countKey = JSON.stringify([revision, suggestion.group.id, ...scope]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    attempt: number;
    value: ChartStarterPointsState;
  }>({ key, attempt, value: { status: "loading" } });

  useEffect(() => {
    let live = true;
    const pending = loadChartStarterAggregate(
      key,
      countKey,
      insight,
      suggestion,
      metric,
    );
    pending.then(
      ({ points, groups }) => {
        if (!live) return;
        setState({
          key,
          attempt,
          value:
            groups > chartStarterGroupLimit(suggestion.rule) ||
            !drawable(suggestion, points)
              ? { status: "unfit" }
              : { status: "ready", points },
        });
      },
      () => {
        if (live) setState({ key, attempt, value: { status: "failed" } });
      },
    );
    return () => {
      live = false;
    };
    // The key covers everything the query reads; a retry asks again.
    // oxlint-disable-next-line react-hooks-js/exhaustive-deps -- key is the structural dependency.
  }, [key, attempt]);

  // A failed query has left the cache, so the next attempt asks the host.
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current =
    state.key === key && state.attempt === attempt
      ? state.value
      : { status: "loading" as const };
  return { ...current, retry };
}
