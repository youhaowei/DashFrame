"use client";

import { useInsightView } from "@/hooks/useInsightView";
import { useDataTables, useInsight } from "@dashframe/core";
import { resolveEncodingToSql } from "@dashframe/engine";
import type { ChartEncoding, Visualization } from "@dashframe/types";
import { Spinner } from "@dashframe/ui";
import { Chart } from "@dashframe/visualization";
import { useMemo } from "react";

const PREVIEW_HEIGHT = 200; // px

function PreviewLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/30">
      <Spinner size="lg" className="text-muted-foreground" />
    </div>
  );
}

interface VisualizationPreviewProps {
  /** The visualization to preview */
  visualization: Visualization;
  /** Height of the preview in pixels (default: 200) */
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
 * This component is self-contained: it fetches the insight and creates
 * the DuckDB view if needed using useInsightView. This unifies the approach
 * with insight detail pages - same hook, same caching, same view creation.
 */
export function VisualizationPreview({
  visualization,
  height = PREVIEW_HEIGHT,
  fallback = <PreviewLoading />,
}: VisualizationPreviewProps) {
  // Fetch the insight for this visualization
  const { data: insight, isLoading: isLoadingInsight } = useInsight(
    visualization.insightId,
  );

  // Fetch data tables for encoding resolution
  const { data: dataTables = [] } = useDataTables();

  // Find the data table for this insight
  const dataTable = useMemo(() => {
    if (!insight?.baseTableId) return undefined;
    return dataTables.find((t) => t.id === insight.baseTableId);
  }, [insight?.baseTableId, dataTables]);

  // Create/get the DuckDB view using the same hook as insight pages
  // This ensures views are created on-demand and properly cached
  const { viewName, isReady, error } = useInsightView(insight);

  // Resolve encoding from storage format (field:<uuid>, metric:<uuid>) to SQL expressions
  // - field:<uuid> → column name (e.g., "Product")
  // - metric:<uuid> → SQL aggregation (e.g., "sum(Quantity)")
  const resolvedEncoding = useMemo((): ChartEncoding => {
    if (!visualization.encoding || !dataTable || !insight) {
      return {};
    }

    // Build resolution context with fields and metrics
    const context = {
      fields: dataTable.fields ?? [],
      metrics: insight.metrics ?? [],
    };

    // Resolve prefixed IDs to SQL expressions
    const resolved = resolveEncodingToSql(visualization.encoding, context);

    return {
      ...resolved,
      xType: visualization.encoding.xType,
      yType: visualization.encoding.yType,
      // Pass through date transforms for temporal bar charts
      xTransform: visualization.encoding.xTransform,
      yTransform: visualization.encoding.yTransform,
    };
  }, [visualization.encoding, dataTable, insight]);

  // Loading state - waiting for insight data or view creation
  if (isLoadingInsight || !isReady || !viewName) {
    return <PreviewLoading />;
  }

  // Error state - show fallback if view creation failed
  if (error) {
    return (
      fallback ?? (
        <div className="flex h-full w-full items-center justify-center bg-muted/50 text-xs text-muted-foreground">
          <span>Failed to load</span>
        </div>
      )
    );
  }

  // Check if encoding has required data channels (x or y)
  // Visualizations created before the encoding fix may be missing these
  const hasValidEncoding = resolvedEncoding.x || resolvedEncoding.y;

  // Show fallback for visualizations with missing encoding (legacy data)
  if (!hasValidEncoding) {
    return (
      fallback ?? (
        <div className="flex h-full w-full items-center justify-center bg-muted/50 text-xs text-muted-foreground">
          <span>Encoding missing</span>
        </div>
      )
    );
  }

  return (
    <div className="h-full w-full overflow-hidden" style={{ height }}>
      <Chart
        tableName={viewName}
        visualizationType={visualization.visualizationType}
        encoding={resolvedEncoding}
        width="container"
        height="container"
        preview
        className="h-full w-full"
      />
    </div>
  );
}
