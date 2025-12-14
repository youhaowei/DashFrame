"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { TopLevelSpec } from "vega-lite";
import type { DataFrameData, Visualization } from "@dashframe/core";
import { useInsights, useDataTables } from "@dashframe/core-dexie";
import { useDataFrameData } from "@/hooks/useDataFrameData";

function PreviewLoading() {
  return (
    <div className="bg-muted flex h-full w-full items-center justify-center">
      <div className="bg-muted-foreground/20 h-3/4 w-3/4 animate-pulse rounded-lg" />
    </div>
  );
}

// Dynamically import VegaChart to avoid SSR issues with Vega-Lite's Set objects
const VegaChart = dynamic(
  () => import("./VegaChart").then((mod) => ({ default: mod.VegaChart })),
  {
    ssr: false,
    loading: () => <PreviewLoading />,
  },
);

/**
 * Build a preview-optimized Vega-Lite spec by using the visualization's
 * existing spec and modifying it for preview display.
 */
function buildPreviewSpec(
  viz: Visualization,
  data: DataFrameData,
  height: number,
): TopLevelSpec {
  // Use the visualization's existing spec as the base
  const baseSpec = viz.spec as unknown as TopLevelSpec;

  // Preview-optimized config: minimal chrome, transparent background
  const previewConfig = {
    background: "transparent",
    view: { stroke: "transparent" },
    axis: {
      domain: false,
      grid: false,
      ticks: false,
      labels: false,
      titleFontSize: 0,
    },
    legend: { disable: true },
    title: { fontSize: 0 },
  };

  // Merge with any existing config from the spec
  const existingConfig = (baseSpec as unknown as { config?: object }).config;
  const mergedConfig = {
    ...(existingConfig || {}),
    ...previewConfig,
  };

  // Return the spec with inline data and preview adjustments
  return {
    ...baseSpec,
    data: { values: data.rows },
    width: "container",
    height: height - 16,
    autosize: { type: "fit", contains: "padding" },
    config: mergedConfig,
    padding: { left: 4, right: 4, top: 8, bottom: 8 },
    // Remove title for cleaner preview
    title: undefined,
  } as TopLevelSpec;
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
 * Loads the FULL dataset to ensure accurate chart rendering (aggregations,
 * distributions, trends). For very large datasets, consider using vgplot
 * which pushes aggregation to DuckDB.
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

  // Load full data for accurate preview (no limit)
  const { data, isLoading, error } = useDataFrameData(dataFrameId);

  // Build preview spec with inline data
  const previewSpec = useMemo<TopLevelSpec | null>(() => {
    if (!data || data.rows.length === 0) return null;
    if (visualization.visualizationType === "table") return null;
    return buildPreviewSpec(visualization, data, height);
  }, [data, visualization, height]);

  // Loading state
  if (isLoading || !dataFrameId) {
    return <PreviewLoading />;
  }

  // Error, no data, or table type - show fallback
  if (error || !previewSpec) {
    return (
      <div className="bg-muted flex h-full w-full items-center justify-center">
        {fallback}
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden">
      <VegaChart spec={previewSpec} className="h-full w-full" />
    </div>
  );
}
