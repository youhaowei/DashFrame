"use client";

import { useState, useMemo, useEffect } from "react";
import { useTheme } from "next-themes";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { TableView } from "./TableView";
import { VegaChart } from "./VegaChart";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { TopLevelSpec } from "vega-lite";
import type { Visualization } from "@/lib/stores/types";
import type { EnhancedDataFrame } from "@dash-frame/dataframe";

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
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-foreground">
            No visualization selected
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Create or select a visualization to display
          </p>
        </div>
      </div>
    );
  }

  const { viz, dataFrame } = activeResolved;

  // Table-only view
  if (viz.visualizationType === "table") {
    return (
      <div className="h-full w-full p-6">
        <TableView dataFrame={dataFrame.data} />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* Chart Section */}
      <div className="shrink-0 p-6">
        <Card className="p-4">
          {/* vegaSpec is guaranteed to be non-null here because we return early if visualizationType is "table" */}
          <VegaChart spec={vegaSpec!} />
        </Card>
      </div>

      {/* Table Toggle */}
      <div className="border-t border-border px-6 py-3 shrink-0">
        <Button
          variant="link"
          size="sm"
          onClick={() => setShowTableWithChart(!showTableWithChart)}
          className="h-auto p-0"
        >
          {showTableWithChart ? "Hide" : "Show"} Data Table
        </Button>
      </div>

      {/* Table Section (collapsible) */}
      {showTableWithChart && (
        <div className="flex-1 min-h-0 px-6 pb-6">
          <TableView dataFrame={dataFrame.data} />
        </div>
      )}
    </div>
  );
}
