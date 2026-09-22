import { useMemo } from "react";
import type { Insight } from "@dashframe/types";
import type { FetchDataParams, FetchDataResult } from "@dashframe/ui";
import { buildPivotSortOptions } from "@/lib/insights/pivot-sort-options";
import { useReportRows } from "./useReportRows";

export function usePivotSortOptions(
  insight: Insight | undefined,
  result: {
    isReady: boolean;
    totalCount: number;
    fetchData: (params: FetchDataParams) => Promise<FetchDataResult>;
  },
  effectiveSelectedFields = insight?.selectedFields,
) {
  const pivotFields = insight?.reporting?.pivotFields ?? [];
  const incompatible = Boolean(
    pivotFields.length &&
    effectiveSelectedFields &&
    pivotFields.some((fieldId) => !effectiveSelectedFields.includes(fieldId)),
  );
  const rows = useReportRows(
    result.isReady && pivotFields.length && !incompatible
      ? result.fetchData
      : undefined,
    result.totalCount,
  );
  const options = useMemo(
    () => buildPivotSortOptions(insight, rows?.rows ?? []),
    [insight, rows?.rows],
  );
  return {
    options,
    error: incompatible
      ? "Reset the viewer dimension controls to choose a pivot cell to sort by."
      : rows?.error,
    retry: incompatible ? undefined : rows?.retry,
  };
}
