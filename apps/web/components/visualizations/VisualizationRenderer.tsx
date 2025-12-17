"use client";

import { useMemo } from "react";
import { useVisualizations, useInsights, useDataTables } from "@dashframe/core";
import { Chart } from "@dashframe/visualization";
import { useDataFramePagination } from "@/hooks/useDataFramePagination";
import { LuLoader } from "react-icons/lu";
import type { UUID } from "@dashframe/types";

interface VisualizationRendererProps {
  /** The visualization ID to render */
  visualizationId: UUID;

  /** Optional className for styling */
  className?: string;

  /** Chart width */
  width?: number | "container";

  /** Chart height */
  height?: number | "container";

  /** Enable preview mode */
  preview?: boolean;
}

/**
 * VisualizationRenderer - Single source of truth for rendering charts
 *
 * This component encapsulates all logic for:
 * 1. Resolving the entity chain (Visualization → Insight → DataTable → DataFrame)
 * 2. Waiting for base table to be ready in DuckDB
 * 3. Rendering the Chart component with correct table name and encoding
 *
 * ## Usage
 *
 * ```tsx
 * <VisualizationRenderer
 *   visualizationId={vizId}
 *   width="container"
 *   height={400}
 * />
 * ```
 *
 * ## Architecture
 *
 * This component ensures chart rendering is consistent across:
 * - Insight suggestions (preview)
 * - Visualization page (full view)
 * - Dashboard cards (thumbnails)
 *
 * Charts query the base DataFrame table directly. The encoding contains
 * aggregation functions (e.g., "sum(revenue)") that vgplot converts to
 * DuckDB queries, enabling query pushdown without loading data into memory.
 */
export function VisualizationRenderer({
  visualizationId,
  className,
  width = "container",
  height = "container",
  preview = false,
}: VisualizationRendererProps) {
  const { data: visualizations = [] } = useVisualizations();
  const { data: insights = [] } = useInsights();
  const { data: dataTables = [] } = useDataTables();

  // Resolve the entity chain
  const visualization = useMemo(
    () => visualizations.find((v) => v.id === visualizationId),
    [visualizations, visualizationId],
  );

  const insight = useMemo(
    () => insights.find((i) => i.id === visualization?.insightId),
    [insights, visualization?.insightId],
  );

  const dataTable = useMemo(
    () => dataTables.find((dt) => dt.id === insight?.baseTableId),
    [dataTables, insight?.baseTableId],
  );

  const dataFrameId = dataTable?.dataFrameId;

  // Compute base table name from DataFrame ID
  const tableName = useMemo(() => {
    if (!dataFrameId) return null;
    return `df_${dataFrameId.replace(/-/g, "_")}`;
  }, [dataFrameId]);

  // Use pagination hook to ensure table is loaded in DuckDB
  const { isReady: isTableReady } = useDataFramePagination(dataFrameId);

  // Loading state
  if (!isTableReady || !tableName || !visualization) {
    return (
      <div className={className} style={{ width, height }}>
        <div className="flex h-full items-center justify-center">
          <div className="text-muted-foreground flex items-center gap-2">
            <LuLoader className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading visualization...</span>
          </div>
        </div>
      </div>
    );
  }

  // Render chart - vgplot will handle aggregations via encoding
  // Use key to force remount when visualization changes
  return (
    <Chart
      key={visualizationId}
      tableName={tableName}
      visualizationType={visualization.visualizationType}
      encoding={visualization.encoding ?? {}}
      className={className}
      width={width}
      height={height}
      preview={preview}
    />
  );
}
