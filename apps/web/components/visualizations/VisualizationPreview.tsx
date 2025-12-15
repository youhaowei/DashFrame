"use client";

import { useMemo } from "react";
import type { Visualization } from "@dashframe/types";
import { useInsights, useDataTables } from "@dashframe/core";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import { Chart } from "@dashframe/visualization";

function PreviewLoading() {
  return (
    <div className="bg-muted flex h-full w-full items-center justify-center">
      <div className="bg-muted-foreground/20 h-3/4 w-3/4 animate-pulse rounded-lg" />
    </div>
  );
}

interface VisualizationPreviewProps {
  /** The visualization to preview */
  visualization: Visualization;
  /** Height of the preview in pixels (default: 160) */
  height?: number;
  /** Fallback element to show when data can't be loaded */
  fallback?: React.ReactNode;
}

/**
 * Renders a small preview of a visualization for use in cards and lists.
 *
 * Uses Chart with preview mode enabled for minimal chrome
 * (no axes, legends, or padding).
 *
 * Data is loaded via useDataFrameData which registers the table in DuckDB.
 * vgplot then queries directly from DuckDB - no inline data needed.
 */
export function VisualizationPreview({
  visualization,
  height = 160,
  fallback,
}: VisualizationPreviewProps) {
  // Derive dataFrameId through the relationship chain:
  // visualization.insightId → insight.baseTableId → dataTable.dataFrameId
  const { data: insights = [] } = useInsights();
  const { data: dataTables = [] } = useDataTables();

  const dataFrameId = useMemo(() => {
    const insight = insights.find((i) => i.id === visualization.insightId);
    if (!insight) return undefined;
    const dataTable = dataTables.find((t) => t.id === insight.baseTableId);
    return dataTable?.dataFrameId;
  }, [insights, dataTables, visualization.insightId]);

  // Compute DuckDB table name from dataFrameId
  const tableName = useMemo(() => {
    if (!dataFrameId) return null;
    return `df_${dataFrameId.replace(/-/g, "_")}`;
  }, [dataFrameId]);

  // Load data to ensure table is registered in DuckDB
  // We don't need the data itself since vgplot queries DuckDB directly
  const { data, isLoading, error } = useDataFrameData(dataFrameId);

  // Loading state
  if (isLoading || !dataFrameId || !tableName) {
    return <PreviewLoading />;
  }

  // Error, no data, or table type - show fallback
  if (error || !data || visualization.visualizationType === "table") {
    return (
      <div className="bg-muted flex h-full w-full items-center justify-center">
        {fallback}
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden" style={{ height }}>
      <Chart
        tableName={tableName}
        visualizationType={visualization.visualizationType}
        encoding={visualization.encoding ?? {}}
        height={height}
        preview
        className="h-full w-full"
      />
    </div>
  );
}
