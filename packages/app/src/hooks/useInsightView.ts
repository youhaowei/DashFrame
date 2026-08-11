import { useInsightPagination } from "@/hooks/useInsightPagination";
import type { EffectiveParams } from "@dashframe/engine";
import type { DataTable, Insight } from "@dashframe/types";

export interface UseInsightViewOptions {
  effectiveParams?: EffectiveParams;
  dataTables?: readonly DataTable[];
}

/**
 * Resolves a chart source to the immutable DataFrame published by the server.
 *
 * `viewName` is retained only as the Chart prop name: its value is a DataFrame
 * UUID, never a browser-created DuckDB view or table name. Mosaic resolves it
 * through the server-frame connector.
 */
export function useInsightView(
  insight: Insight | null | undefined,
  _options: UseInsightViewOptions = {},
) {
  const result = useInsightPagination({
    insight: insight ?? ({} as Insight),
    showModelPreview: true,
    enabled: Boolean(insight?.id && insight.baseTableId),
  });

  return {
    viewName: result.dataFrameId,
    isReady: result.isReady && result.dataFrameId !== null,
    error: result.error,
    schema: result.schema,
    sampleRows: result.sampleRows,
    totalCount: result.totalCount,
    resolvedFields: result.resolvedFields,
    nativeCapable: true,
  };
}
