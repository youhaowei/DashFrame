"use client";

import { useState, useMemo, useEffect } from "react";
import { useTheme } from "next-themes";
import { BarChart3, Table as TableIcon } from "lucide-react";
import type { TopLevelSpec } from "vega-lite";
import type { EnhancedDataFrame } from "@dash-frame/dataframe";
import type { Visualization } from "@/lib/stores/types";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TableView } from "./TableView";
import { VegaChart } from "./VegaChart";

const formatVizType = (type: Visualization["visualizationType"]) =>
  `${type.slice(0, 1).toUpperCase()}${type.slice(1)}`;

// Helper to get CSS variable color value
function getCSSColor(variable: string): string {
  if (typeof window === "undefined") return "#000000";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  return value || "#000000";
}

// Get theme-aware Vega-Lite config
function getVegaThemeConfig() {
  return {
    background: getCSSColor("--color-card"),
    view: {
      stroke: getCSSColor("--color-border"),
      strokeWidth: 1,
    },
    axis: {
      domainColor: getCSSColor("--color-border"),
      gridColor: getCSSColor("--color-border"),
      tickColor: getCSSColor("--color-border"),
      labelColor: getCSSColor("--color-foreground"),
      titleColor: getCSSColor("--color-foreground"),
      labelFont: "inherit",
      titleFont: "inherit",
    },
    legend: {
      labelColor: getCSSColor("--color-foreground"),
      titleColor: getCSSColor("--color-foreground"),
      labelFont: "inherit",
      titleFont: "inherit",
    },
    title: {
      color: getCSSColor("--color-foreground"),
      font: "inherit",
    },
  };
}

function buildVegaSpec(
  viz: Visualization,
  dataFrame: EnhancedDataFrame,
): TopLevelSpec {
  const { visualizationType, encoding } = viz;

  // Common spec properties
  const commonSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json" as const,
    data: { values: dataFrame.data.rows },
    width: "container" as const,
    height: 400,
    config: getVegaThemeConfig(),
  };

  // If no encoding is set, use defaults
  const x = encoding?.x || dataFrame.data.columns[0]?.name || "x";
  const y =
    encoding?.y ||
    dataFrame.data.columns.find((col) => col.type === "number")?.name ||
    dataFrame.data.columns[1]?.name ||
    "y";

  switch (visualizationType) {
    case "bar":
      return {
        ...commonSpec,
        mark: "bar" as const,
        encoding: {
          x: { field: x, type: "nominal" as const },
          y: { field: y, type: "quantitative" as const },
          ...(encoding?.color && {
            color: { field: encoding.color, type: "nominal" as const },
          }),
        },
      };

    case "line":
      return {
        ...commonSpec,
        mark: "line" as const,
        encoding: {
          x: { field: x, type: "ordinal" as const },
          y: { field: y, type: "quantitative" as const },
          ...(encoding?.color && {
            color: { field: encoding.color, type: "nominal" as const },
          }),
        },
      };

    case "scatter":
      return {
        ...commonSpec,
        mark: "point" as const,
        encoding: {
          x: { field: x, type: "quantitative" as const },
          y: { field: y, type: "quantitative" as const },
          ...(encoding?.color && {
            color: { field: encoding.color, type: "nominal" as const },
          }),
          ...(encoding?.size && {
            size: { field: encoding.size, type: "quantitative" as const },
          }),
        },
      };

    case "area":
      return {
        ...commonSpec,
        mark: "area" as const,
        encoding: {
          x: { field: x, type: "ordinal" as const },
          y: { field: y, type: "quantitative" },
          ...(encoding?.color && {
            color: { field: encoding.color, type: "nominal" as const },
          }),
        },
      };

    default:
      // Fallback to bar chart
      return {
        ...commonSpec,
        mark: "bar" as const,
        encoding: {
          x: { field: x, type: "nominal" as const },
          y: { field: y, type: "quantitative" as const },
        },
      };
  }
}

export function VisualizationDisplay() {
  const [isMounted, setIsMounted] = useState(false);
  const { resolvedTheme } = useTheme();
  const activeId = useVisualizationsStore((state) => state.activeId);
  const visualizationsMap = useVisualizationsStore(
    (state) => state.visualizations,
  );
  const dataFramesMap = useDataFramesStore((state) => state.dataFrames);

  const activeResolved = useMemo(() => {
    if (!activeId) return null;
    const viz = visualizationsMap.get(activeId);
    if (!viz) return null;
    const dataFrame = dataFramesMap.get(viz.source.dataFrameId);
    if (!dataFrame) return null;
    return { viz, dataFrame };
  }, [activeId, visualizationsMap, dataFramesMap]);

  const [showTableWithChart, setShowTableWithChart] = useState(true);

  // Build Vega spec with theme awareness (must be called before any conditional returns)
  const vegaSpec = useMemo(() => {
    if (!activeResolved) return null;
    const { viz, dataFrame } = activeResolved;
    if (viz.visualizationType === "table") return null;
    return buildVegaSpec(viz, dataFrame);
  }, [activeResolved, resolvedTheme]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Prevent hydration mismatch - always show empty state on server
  if (!isMounted || !activeResolved) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <div className="w-full max-w-lg rounded-3xl border border-dashed border-border/70 bg-background/40 p-10 text-center shadow-inner shadow-black/5">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <BarChart3 className="h-6 w-6" />
          </div>
          <p className="text-lg font-semibold text-foreground">No visualization yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Use the controls on the left to create or select a visualization to preview.
          </p>
        </div>
      </div>
    );
  }

  const { viz, dataFrame } = activeResolved;
  const vizTypeLabel = formatVizType(viz.visualizationType);

  if (viz.visualizationType === "table") {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border/60 bg-background/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2 text-primary">
              <TableIcon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs tracking-wide text-muted-foreground">
                Data preview
              </p>
              <p className="text-lg font-semibold text-foreground">{viz.name}</p>
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 px-6 py-6">
          <div className="h-full rounded-2xl border border-border/60 bg-background/60 p-4 shadow-inner shadow-black/5">
            <TableView dataFrame={dataFrame.data} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-gradient-to-r from-background/80 via-background/60 to-background/80 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xl font-semibold text-foreground">{viz.name}</p>
            <p className="text-sm text-muted-foreground">
              {dataFrame.metadata.rowCount.toLocaleString()} rows ·{" "}
              {dataFrame.metadata.columnCount} columns
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs tracking-wide text-muted-foreground">
            <span className="rounded-full border border-border/60 bg-background/70 px-3 py-1 font-semibold text-foreground">
              {vizTypeLabel}
            </span>
            {viz.encoding?.color && (
              <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                Color: {viz.encoding.color}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="shrink-0 px-6 py-6">
          <Card className="border border-border/60 bg-background/40 p-4 shadow-xl shadow-black/5">
            <VegaChart spec={vegaSpec!} />
          </Card>
        </div>

        <div className="shrink-0 border-t border-border/60 bg-background/40 px-6 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Data table</p>
              <p className="text-xs text-muted-foreground">
                Explore the underlying rows powering this visualization.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTableWithChart(!showTableWithChart)}
            >
              {showTableWithChart ? "Hide table" : "Show table"}
            </Button>
          </div>
        </div>

        {showTableWithChart && (
          <div className="flex-1 min-h-0 px-6 py-6">
            <div className="h-full rounded-2xl border border-border/60 bg-background/60 p-4 shadow-inner shadow-black/5">
              <TableView dataFrame={dataFrame.data} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
