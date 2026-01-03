"use client";

import { useState, useMemo, useEffect, useLayoutEffect, useRef } from "react";
import {
  ChartIcon,
  TableIcon,
  LayersIcon,
  Surface,
  Toggle,
  VirtualTable,
  Spinner,
  type VirtualTableColumnConfig,
} from "@dashframe/ui";
import { useVisualizations, useInsights } from "@dashframe/core";
import type { Visualization, ChartEncoding, Insight } from "@dashframe/types";
import { parseEncoding } from "@dashframe/types";
import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import { useInsightView } from "@/hooks/useInsightView";
import { useInsightPagination } from "@/hooks/useInsightPagination";
import { Chart } from "@dashframe/visualization";

// Minimum visible rows needed to enable "Show Both" mode
const MIN_VISIBLE_ROWS_FOR_BOTH = 5;

export function VisualizationDisplay({
  visualizationId,
}: {
  visualizationId?: string;
}) {
  // Use effect to detect mounting (avoids hydration mismatch)
  const [isMounted, setIsMounted] = useState(false);
  const [visibleRows, setVisibleRows] = useState<number>(10);
  const [activeTab, setActiveTab] = useState<string>("both");
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // Set mounted state after hydration
  useEffect(() => {
    const raf = requestAnimationFrame(() => setIsMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Dexie hooks for data
  const { data: visualizations = [], isLoading: isVizLoading } =
    useVisualizations();
  const { data: insights = [] } = useInsights();

  // Get the visualization
  const activeViz = useMemo((): Visualization | null => {
    if (!visualizationId) return null;
    return visualizations.find((v) => v.id === visualizationId) ?? null;
  }, [visualizationId, visualizations]);

  // Get insight for the visualization
  const insight = useMemo(() => {
    if (!activeViz) return undefined;
    return insights.find((i) => i.id === activeViz.insightId);
  }, [activeViz, insights]);

  // Build an Insight-compatible object for useInsightView
  // This transforms the store insight format to what useInsightView expects
  const insightForView: Insight | null = useMemo(() => {
    if (!insight) return null;
    return {
      id: insight.id,
      name: insight.name,
      baseTableId: insight.baseTableId,
      joins: insight.joins,
    } as Insight;
  }, [insight]);

  // Use insight view hook to get the proper table name (handles joins)
  const { viewName: insightViewName, isReady: isInsightViewReady } =
    useInsightView(insightForView);

  // Use insight pagination for table data (queries DuckDB directly)
  const {
    fetchData,
    totalCount,
    columns,
    isReady: isPaginationReady,
    columnDisplayNames,
  } = useInsightPagination({
    insight: insightForView ?? ({} as Insight),
    showModelPreview: false, // Apply full insight transformations
    enabled: !!insightForView, // Only enable when we have an insight
  });

  // Helper to calculate visible rows from container dimensions
  const calculateVisibleRows = () => {
    if (!containerRef.current || !headerRef.current) return null;
    const containerHeight = containerRef.current.clientHeight;
    if (containerHeight < 100) return null; // Layout not ready

    const headerHeight = headerRef.current.offsetHeight || 60;
    const contentPadding = 20; // mt-3 + gap

    // Table gets max 40% of the available content area
    const availableContentHeight =
      containerHeight - headerHeight - contentPadding;
    const maxTableHeight = Math.floor(availableContentHeight * 0.4);

    const rowHeight = 36;
    const tableHeaderHeight = 40;
    return Math.max(
      0,
      Math.floor((maxTableHeight - tableHeaderHeight) / rowHeight),
    );
  };

  // Watch container size changes to detect available space for "Show Both" mode
  const isDataReady = !!activeViz && isPaginationReady;

  // Immediate measurement on layout (before paint) to set correct initial tab
  useLayoutEffect(() => {
    if (!isDataReady) return;
    const rows = calculateVisibleRows();
    if (rows !== null) {
      requestAnimationFrame(() => setVisibleRows(rows));
    }
  }, [isDataReady]);

  // Continue watching for resize changes
  useEffect(() => {
    if (!containerRef.current || !isDataReady) return;

    const observer = new ResizeObserver(() => {
      const rows = calculateVisibleRows();
      if (rows !== null) {
        requestAnimationFrame(() => setVisibleRows(rows));
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isDataReady]);

  // Get table name for chart rendering from insight view
  // The insight view is created by useInsightView and includes all joined columns with UUID aliases
  const tableName = useMemo(() => {
    if (insightViewName && isInsightViewReady) {
      return insightViewName;
    }
    return null;
  }, [insightViewName, isInsightViewReady]);

  /**
   * Convert encoding value from storage format (field:<uuid>) to SQL column alias (field_<uuid>).
   * Also handles metric: prefix conversion.
   */
  const resolveEncodingChannel = (
    value: string | undefined,
  ): string | undefined => {
    if (!value) return undefined;
    const parsed = parseEncoding(value);
    if (!parsed) return undefined;
    return parsed.type === "field"
      ? fieldIdToColumnAlias(parsed.id)
      : metricIdToColumnAlias(parsed.id);
  };

  // Resolve encoding from storage format (field:<uuid>) to SQL column aliases (field_<uuid>)
  // The encoding values stored in the visualization use prefix format, but the SQL columns
  // use underscore-based aliases created by buildInsightSQL
  const resolvedEncoding = useMemo((): ChartEncoding => {
    if (!activeViz?.encoding) {
      return {};
    }

    // Convert each channel from field:<uuid> to field_<uuid> format
    const x = resolveEncodingChannel(activeViz.encoding.x);
    const y = resolveEncodingChannel(activeViz.encoding.y);
    const color = resolveEncodingChannel(activeViz.encoding.color);
    const size = resolveEncodingChannel(activeViz.encoding.size);

    return {
      x,
      y,
      color,
      size,
      xType: activeViz.encoding.xType,
      yType: activeViz.encoding.yType,
      // Pass through date transforms for temporal bar charts
      // These tell the renderer to use band scale (suppresses vgplot warning)
      xTransform: activeViz.encoding.xTransform,
      yTransform: activeViz.encoding.yTransform,
      // Include human-readable axis labels for chart display
      // Look up using the resolved column alias
      xLabel: x ? columnDisplayNames[x] : undefined,
      yLabel: y ? columnDisplayNames[y] : undefined,
      colorLabel: color ? columnDisplayNames[color] : undefined,
      sizeLabel: size ? columnDisplayNames[size] : undefined,
    };
  }, [activeViz, columnDisplayNames]);

  // Build column configs for VirtualTable to show human-readable headers
  const columnConfigs = useMemo((): VirtualTableColumnConfig[] => {
    return columns.map((col) => ({
      id: col.name,
      label: columnDisplayNames[col.name] ?? col.name,
    }));
  }, [columns, columnDisplayNames]);

  // Get human-readable display name for color encoding
  const colorDisplayName = useMemo(() => {
    const colorEncoding = activeViz?.encoding?.color;
    if (!colorEncoding) return null;
    // Resolve to column alias first, then look up display name
    const colorAlias = resolveEncodingChannel(colorEncoding);
    if (!colorAlias) return null;
    return columnDisplayNames[colorAlias] ?? colorAlias;
  }, [activeViz, columnDisplayNames]);

  // Check if there's enough space to show both views
  const canShowBoth = visibleRows >= MIN_VISIBLE_ROWS_FOR_BOTH;
  const bothTooltip = canShowBoth
    ? "Show chart and table simultaneously"
    : `Not enough space (${visibleRows} visible rows). Need at least ${MIN_VISIBLE_ROWS_FOR_BOTH} rows.`;

  // Automatically switch to "chart" when space becomes insufficient
  const previousCanShowBothRef = useRef(canShowBoth);
  useEffect(() => {
    const prevCanShowBoth = previousCanShowBothRef.current;

    // Only react to canShowBoth changing from true to false
    if (prevCanShowBoth && !canShowBoth && activeTab === "both") {
      requestAnimationFrame(() => setActiveTab("chart"));
    }

    previousCanShowBothRef.current = canShowBoth;
  }, [canShowBoth, activeTab]);

  // Show loading when not mounted, loading visualization, or waiting for data to be ready
  const isWaitingForData =
    (visualizationId && !activeViz) ||
    isVizLoading ||
    !isInsightViewReady ||
    !isPaginationReady;

  if (!isMounted || isWaitingForData) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <Surface
          elevation="inset"
          className="w-full max-w-lg rounded-3xl p-10 text-center"
        >
          <div className="bg-primary/10 text-primary mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <Spinner size="lg" />
          </div>
          <p className="text-foreground text-lg font-semibold">
            Loading visualization...
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Please wait while the data is being loaded.
          </p>
        </Surface>
      </div>
    );
  }

  // No visualization selected
  if (!activeViz) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <Surface
          elevation="inset"
          className="w-full max-w-lg rounded-3xl p-10 text-center"
        >
          <div className="bg-primary/10 text-primary mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <ChartIcon className="h-6 w-6" />
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

  // Unified toggle view with Chart, Table, and Both options
  return (
    <div ref={containerRef} className="flex h-full flex-col">
      <div ref={headerRef} className="border-border/60 border-b px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-foreground text-xl font-semibold">
              {activeViz.name}
            </p>
            <div className="flex items-center gap-2">
              <p className="text-muted-foreground text-sm">
                {totalCount.toLocaleString()} rows · {columns.length} columns
              </p>
              {colorDisplayName && (
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                  Color: {colorDisplayName}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Toggle
              variant="outline"
              size="sm"
              value={activeTab}
              onValueChange={setActiveTab}
              className="shrink-0"
              options={[
                {
                  value: "chart",
                  icon: <ChartIcon className="h-3.5 w-3.5" />,
                  label: "Chart",
                },
                {
                  value: "table",
                  icon: <TableIcon className="h-3.5 w-3.5" />,
                  label: "Table",
                },
                {
                  value: "both",
                  icon: <LayersIcon className="h-3.5 w-3.5" />,
                  label: "Both",
                  disabled: !canShowBoth,
                  tooltip: bothTooltip,
                },
              ]}
            />
          </div>
        </div>
      </div>

      {activeTab === "chart" && tableName && (
        <div className="mt-3 min-h-0 flex-1 overflow-hidden px-4 pb-8">
          <Chart
            tableName={tableName}
            visualizationType={activeViz.visualizationType}
            encoding={resolvedEncoding}
            className="h-full w-full"
          />
        </div>
      )}

      {activeTab === "table" && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col px-4">
          <Surface
            elevation="inset"
            className="flex min-h-0 flex-1 flex-col p-4"
          >
            <VirtualTable
              columns={columns}
              onFetchData={fetchData}
              columnConfigs={columnConfigs}
              height="100%"
              className="flex-1"
            />
          </Surface>
        </div>
      )}

      {activeTab === "both" && tableName && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Chart takes 60% of space */}
          <div className="h-[60%] min-h-[200px] overflow-hidden px-4 pb-4">
            <Chart
              tableName={tableName}
              visualizationType={activeViz.visualizationType}
              encoding={resolvedEncoding}
              className="h-full w-full"
            />
          </div>
          {/* Table capped at 40% of space */}
          <div className="flex h-[40%] max-h-[40%] min-h-0 flex-col overflow-hidden px-4">
            <Surface
              elevation="inset"
              className="flex min-h-0 flex-1 flex-col p-4"
            >
              <VirtualTable
                columns={columns}
                onFetchData={fetchData}
                columnConfigs={columnConfigs}
                height="100%"
                className="flex-1"
              />
            </Surface>
          </div>
        </div>
      )}
    </div>
  );
}
