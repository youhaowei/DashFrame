"use client";

import { useMemo } from "react";
import type { Visualization, ChartEncoding } from "@dashframe/types";
import { parseEncoding } from "@dashframe/types";
import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import { useInsight } from "@dashframe/core";
import { Spinner } from "@dashframe/ui";
import { useInsightView } from "@/hooks/useInsightView";
import { Chart } from "@dashframe/visualization";

const PREVIEW_HEIGHT = 200; // px

function PreviewLoading() {
  return (
    <div className="bg-muted/30 flex h-full w-full items-center justify-center">
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
 * Convert encoding value from storage format (field:<uuid>) to SQL column alias (field_<uuid>).
 */
function resolveEncodingChannel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = parseEncoding(value);
  if (!parsed) return undefined;
  return parsed.type === "field"
    ? fieldIdToColumnAlias(parsed.id)
    : metricIdToColumnAlias(parsed.id);
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

  // Create/get the DuckDB view using the same hook as insight pages
  // This ensures views are created on-demand and properly cached
  const { viewName, isReady, error } = useInsightView(insight);

  // Resolve encoding from storage format (field:<uuid>) to SQL column aliases (field_<uuid>)
  const resolvedEncoding = useMemo((): ChartEncoding => {
    if (!visualization.encoding) {
      return {};
    }

    return {
      x: resolveEncodingChannel(visualization.encoding.x),
      y: resolveEncodingChannel(visualization.encoding.y),
      color: resolveEncodingChannel(visualization.encoding.color),
      size: resolveEncodingChannel(visualization.encoding.size),
      xType: visualization.encoding.xType,
      yType: visualization.encoding.yType,
      // Pass through date transforms for temporal bar charts
      xTransform: visualization.encoding.xTransform,
      yTransform: visualization.encoding.yTransform,
    };
  }, [visualization.encoding]);

  // Loading state - waiting for insight data or view creation
  if (isLoadingInsight || !isReady || !viewName) {
    return <PreviewLoading />;
  }

  // Error state - show fallback if view creation failed
  if (error) {
    return (
      fallback ?? (
        <div className="bg-muted/50 text-muted-foreground flex h-full w-full items-center justify-center text-xs">
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
        <div className="bg-muted/50 text-muted-foreground flex h-full w-full items-center justify-center text-xs">
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
