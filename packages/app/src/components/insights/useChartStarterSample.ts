import {
  suggestChartStarters,
  type ChartStarterSuggestion,
} from "@/lib/visualizations/chart-starter";
import type { ColumnAnalysis, DataTable, Insight } from "@dashframe/types";
import { useMemo, useState } from "react";
import type { ChartStarterSample } from "./ChartStarter";
import { isPlainSumColumn } from "./config-panel/MetricsSection";

export interface ChartStarterResult {
  /** False while a run (a pick, or a source refresh) is still pending. */
  isReady: boolean;
  schema: ChartStarterSample["schema"];
  rows: ChartStarterSample["rows"];
  totalCount: number;
  analysis: readonly ColumnAnalysis[];
}

/**
 * The rows an empty chart's starter works from, and what it may offer.
 *
 * The sample is a snapshot of the pristine result, kept through a partial
 * pick (which groups the result) so the preview and its header actions stay
 * put. `suggestions` are every rule match on that sample; `cards` are the ones
 * a person may pick now: only while the chart is pristine and its result is
 * current, never while a refresh of the source is pending.
 */
export function useChartStarterSample({
  enabled,
  insight,
  dataTable,
  result,
}: {
  enabled: boolean;
  insight: Pick<Insight, "id" | "selectedFields" | "metrics">;
  dataTable: DataTable | undefined;
  result: ChartStarterResult;
}): {
  sample: ChartStarterSample | null;
  suggestions: ChartStarterSuggestion[];
  cards: ChartStarterSuggestion[];
} {
  const pristine =
    insight.selectedFields.length === 0 && (insight.metrics ?? []).length === 0;
  const [snapshot, setSnapshot] = useState<
    (ChartStarterSample & { insightId: string }) | null
  >(null);
  // Rows of a result with picks in it. Right after the picks are removed the
  // result still holds them until the new run lands; never snapshot those.
  const [pickedRows, setPickedRows] = useState<unknown>(null);
  if (!pristine && pickedRows !== result.rows) setPickedRows(result.rows);
  if (
    enabled &&
    pristine &&
    result.isReady &&
    result.rows !== pickedRows &&
    (snapshot?.insightId !== insight.id || snapshot.rows !== result.rows)
  ) {
    setSnapshot({
      insightId: insight.id,
      schema: result.schema,
      rows: result.rows,
      totalCount: result.totalCount,
      analysis: result.analysis,
    });
  }
  const sample = snapshot?.insightId === insight.id ? snapshot : null;
  const suggestions = useMemo(
    () =>
      sample
        ? suggestChartStarters(
            dataTable?.fields ?? [],
            sample.analysis,
            sample.totalCount,
            {
              // Every candidate: a card that turns out not to fit gives way
              // to the next one.
              limit: Infinity,
              canSum: (field) =>
                !!dataTable &&
                !!field.columnName &&
                isPlainSumColumn(dataTable, field.columnName),
            },
          )
        : [],
    [dataTable, sample],
  );
  return {
    sample,
    suggestions,
    cards: pristine && result.isReady ? suggestions : [],
  };
}
