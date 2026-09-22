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
) {
  const rows = useReportRows(
    result.isReady && insight?.reporting?.pivotFields?.length
      ? result.fetchData
      : undefined,
    result.totalCount,
  );
  const options = useMemo(
    () => buildPivotSortOptions(insight, rows?.rows ?? []),
    [insight, rows?.rows],
  );
  return { options, error: rows?.error, retry: rows?.retry };
}
