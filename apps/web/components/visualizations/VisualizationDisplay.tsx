"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { BarChart3, TableIcon, Layers, Surface, Toggle } from "@dashframe/ui";
import type { TopLevelSpec } from "vega-lite";
import type { EnhancedDataFrame } from "@dashframe/dataframe";
import type { Visualization } from "@/lib/stores/types";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { DataFrameTable } from "@dashframe/ui";
import { VegaChart } from "./VegaChart";

// StandardType is not exported from vega-lite's main module
type StandardType = "quantitative" | "ordinal" | "temporal" | "nominal";

// Minimum visible rows needed to enable "Show Both" mode
const MIN_VISIBLE_ROWS_FOR_BOTH = 5;

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
    $schema: "https://vega.github.io/schema/vega-lite/v6.json" as const,
    data: { values: dataFrame.data.rows },
    width: "container" as const,
    height: 400,
    config: getVegaThemeConfig(),
  };

  // If no encoding is set, use defaults
  const x = encoding?.x || dataFrame.data.columns?.[0]?.name || "x";
  const y =
    encoding?.y ||
    dataFrame.data.columns?.find((col) => col.type === "number")?.name ||
    dataFrame.data.columns?.[1]?.name ||
    "y";

  switch (visualizationType) {
    case "bar":
      return {
        ...commonSpec,
        mark: { type: "bar" as const, stroke: null },
        encoding: {
          x: { field: x, type: (encoding?.xType || "nominal") as StandardType },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
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
          x: { field: x, type: (encoding?.xType || "ordinal") as StandardType },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
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
          x: {
            field: x,
            type: (encoding?.xType || "quantitative") as StandardType,
          },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
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
          x: { field: x, type: (encoding?.xType || "ordinal") as StandardType },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
          ...(encoding?.color && {
            color: { field: encoding.color, type: "nominal" as const },
          }),
        },
      };

    default:
      // Fallback to bar chart
      return {
        ...commonSpec,
        mark: { type: "bar" as const, stroke: null },
        encoding: {
          x: { field: x, type: (encoding?.xType || "nominal") as StandardType },
          y: {
            field: y,
            type: (encoding?.yType || "quantitative") as StandardType,
          },
        },
      };
  }
}

export function VisualizationDisplay() {
  const [isMounted] = useState(() => typeof window !== "undefined");
  const [visibleRows, setVisibleRows] = useState<number>(10);
  const [activeTab, setActiveTab] = useState<string>("both");
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const activeId = useVisualizationsStore((state) => state.activeId);
  const visualizationsMap = useVisualizationsStore(
    (state) => state.visualizations,
  );
  const dataFramesMap = useDataFramesStore((state) => state.dataFrames);

  // Watch container size changes to detect available space for "Show Both" mode
  useEffect(() => {
    if (!containerRef.current || !headerRef.current) {
      console.log("Refs not ready:", {
        container: !!containerRef.current,
        header: !!headerRef.current,
      });
      return;
    }

    console.log("Setting up ResizeObserver");

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const containerHeight = entry.contentRect.height;
        // Measure actual header height from DOM
        const headerHeight = headerRef.current?.offsetHeight || 100;
        const chartHeight = 400; // Chart height from Vega spec
        const tabContentPadding = 12; // mt-3 on TabsContent
        const chartBottomPadding = 8; // pb-2 on chart container
        const spacing = 40; // Additional spacing for borders, table wrapper padding, etc.

        const availableForTable =
          containerHeight -
          headerHeight -
          chartHeight -
          tabContentPadding -
          chartBottomPadding -
          spacing;
        const rowHeight = 30; // Compact row height
        const calculatedVisibleRows = Math.floor(availableForTable / rowHeight);

        // Debug logging
        console.log("Space calculation:", {
          containerHeight,
          headerHeight,
          availableForTable,
          calculatedVisibleRows,
          canShowBoth: calculatedVisibleRows >= MIN_VISIBLE_ROWS_FOR_BOTH,
        });

        setVisibleRows(calculatedVisibleRows);
      }
    });

    observer.observe(containerRef.current);
    return () => {
      console.log("Cleaning up ResizeObserver");
      observer.disconnect();
    };
  }, [activeId]);

  const activeResolved = useMemo(() => {
    if (!activeId) return null;
    const viz = visualizationsMap.get(activeId);
    if (!viz) return null;
    const dataFrame = dataFramesMap.get(viz.source.dataFrameId);
    if (!dataFrame) return null;
    return { viz, dataFrame };
  }, [activeId, visualizationsMap, dataFramesMap]);

  // Build Vega spec with theme awareness (must be called before any conditional returns)
  const vegaSpec = useMemo(() => {
    if (!activeResolved) return null;
    const { viz, dataFrame } = activeResolved;
    if (viz.visualizationType === "table") return null;
    return buildVegaSpec(viz, dataFrame);
  }, [activeResolved]);

  // Check if there's enough space to show both views
  const canShowBoth = visibleRows >= MIN_VISIBLE_ROWS_FOR_BOTH;
  const bothTooltip = canShowBoth
    ? "Show chart and table simultaneously"
    : `Not enough space (${visibleRows} visible rows). Need at least ${MIN_VISIBLE_ROWS_FOR_BOTH} rows.`;

  // Automatically switch to "both" when space becomes available, or to "chart" when insufficient
  // Using a ref to track changes and prevent cascading renders
  const previousStateRef = useRef({ canShowBoth, activeTab });
  useEffect(() => {
    const prev = previousStateRef.current;
    const canShowBothChanged = prev.canShowBoth !== canShowBoth;

    // This effect synchronizes activeTab state with the canShowBoth external condition (window size)
    // The ref pattern prevents cascading renders by only updating when canShowBoth actually changes
    if (canShowBothChanged) {
      if (canShowBoth && activeTab !== "both") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveTab("both");
      } else if (!canShowBoth && activeTab === "both") {
        setActiveTab("chart");
      }
    }
    previousStateRef.current = { canShowBoth, activeTab };
  }, [canShowBoth, activeTab]);

  // Prevent hydration mismatch - always show empty state on server
  if (!isMounted || !activeResolved) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <Surface
          elevation="inset"
          className="w-full max-w-lg rounded-3xl p-10 text-center"
        >
          <div className="bg-primary/10 text-primary mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <BarChart3 className="h-6 w-6" />
          </div>
          <p className="text-foreground text-lg font-semibold">
            No visualization yet
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Use the controls on the left to create or select a visualization to
            preview.
          </p>
        </Surface>
      </div>
    );
  }

  const { viz, dataFrame } = activeResolved;

  if (viz.visualizationType === "table") {
    return (
      <div className="flex h-full flex-col">
        <div className="border-border/60 bg-background/60 border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary rounded-full p-2">
              <TableIcon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-muted-foreground text-xs tracking-wide">
                Data preview
              </p>
              <p className="text-foreground text-lg font-semibold">
                {viz.name}
              </p>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 px-6 py-6">
          <Surface elevation="inset" className="h-full p-4">
            <DataFrameTable dataFrame={dataFrame.data} />
          </Surface>
        </div>
      </div>
    );
  }

  // Unified toggle view with Chart, Table, and Both options
  return (
    <div ref={containerRef} className="flex h-full flex-col">
      <div ref={headerRef} className="border-border/60 border-b px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-foreground text-xl font-semibold">{viz.name}</p>
            <div className="flex items-center gap-2">
              <p className="text-muted-foreground text-sm">
                {dataFrame.metadata.rowCount.toLocaleString()} rows ·{" "}
                {dataFrame.metadata.columnCount} columns
              </p>
              {viz.encoding?.color && (
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                  Color: {viz.encoding.color}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Toggle
              variant="default"
              value={activeTab}
              onValueChange={setActiveTab}
              className="shrink-0"
              options={[
                {
                  value: "chart",
                  icon: <BarChart3 className="h-4 w-4" />,
                  label: "Chart",
                },
                {
                  value: "table",
                  icon: <TableIcon className="h-4 w-4" />,
                  label: "Data Table",
                },
                {
                  value: "both",
                  icon: <Layers className="h-4 w-4" />,
                  label: "Both",
                  disabled: !canShowBoth,
                  tooltip: bothTooltip,
                },
              ]}
            />
          </div>
        </div>
      </div>

      {activeTab === "chart" && (
        <div className="mt-3 flex min-h-0 flex-1 px-4">
          <div className="h-full w-full">
            <VegaChart spec={vegaSpec!} />
          </div>
        </div>
      )}

      {activeTab === "table" && (
        <div className="mt-3 flex min-h-0 flex-1 px-4">
          <Surface elevation="inset" className="h-full w-full">
            <DataFrameTable dataFrame={dataFrame.data} />
          </Surface>
        </div>
      )}

      {activeTab === "both" && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-4 pb-2">
            <VegaChart spec={vegaSpec!} />
          </div>
          <div className="min-h-0 flex-1">
            <Surface elevation="inset" className="h-full">
              <DataFrameTable dataFrame={dataFrame.data} />
            </Surface>
          </div>
        </div>
      )}
    </div>
  );
}
