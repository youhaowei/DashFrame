"use client";

import { useMemo, useState, useEffect } from "react";
import type { Visualization, ChartEncoding } from "@dashframe/types";
import { parseEncoding } from "@dashframe/types";
import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import { useDuckDB } from "@/components/providers/DuckDBProvider";
import { getCachedViewName } from "@/hooks/useInsightView";
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
 * The view name is deterministic: `insight_view_<insightId>`.
 * This component assumes the parent page (InsightView) has already created the view.
 * It polls DuckDB to check if the view exists before rendering.
 */
export function VisualizationPreview({
  visualization,
  height = 160,
  fallback,
}: VisualizationPreviewProps) {
  const { connection, isInitialized } = useDuckDB();

  // Check cache first for instant rendering (set by useInsightView)
  const cachedViewName = visualization.insightId
    ? getCachedViewName(visualization.insightId)
    : null;

  // Use cached view name if available, otherwise compute it
  const viewName = useMemo(() => {
    if (cachedViewName) return cachedViewName;
    if (!visualization.insightId) return null;
    return `insight_view_${visualization.insightId.replace(/-/g, "_")}`;
  }, [visualization.insightId, cachedViewName]);

  // If we have a cached view name, we know it exists - skip polling
  const [viewExists, setViewExists] = useState(!!cachedViewName);

  // Only poll DuckDB if view isn't in cache
  useEffect(() => {
    // If cache hit, view already exists - no need to poll
    if (cachedViewName) {
      setViewExists(true);
      return;
    }

    if (!connection || !isInitialized || !viewName) {
      setViewExists(false);
      return;
    }

    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 5; // Reduced from 10 - faster failure
    const retryDelay = 100; // Reduced from 200ms - faster polling

    const checkViewExists = async () => {
      try {
        // Query information_schema to check if view exists
        const result = await connection.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_name = '${viewName}'
          LIMIT 1
        `);
        const exists = result.toArray().length > 0;

        if (!cancelled) {
          if (exists) {
            setViewExists(true);
          } else if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(checkViewExists, retryDelay);
          }
        }
      } catch (err) {
        console.error("[VisualizationPreview] Error checking view:", err);
        if (!cancelled && retryCount < maxRetries) {
          retryCount++;
          setTimeout(checkViewExists, retryDelay);
        }
      }
    };

    checkViewExists();

    return () => {
      cancelled = true;
    };
  }, [connection, isInitialized, viewName, cachedViewName]);

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
    };
  }, [visualization.encoding]);

  // Loading state - waiting for DuckDB or view to be created
  if (!isInitialized || !viewName || !viewExists) {
    return <PreviewLoading />;
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
        height={height}
        preview
        className="h-full w-full"
      />
    </div>
  );
}
