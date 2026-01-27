"use client";

import { useInsightPagination } from "@/hooks/useInsightPagination";
import { useInsightView } from "@/hooks/useInsightView";
import { useDataTables, useInsights, useVisualizations } from "@dashframe/core";
import { resolveEncodingToSql } from "@dashframe/engine";
import type { ChartEncoding, Insight, Visualization } from "@dashframe/types";
import {
  ChartIcon,
  LayersIcon,
  Spinner,
  Surface,
  TableIcon,
  Toggle,
  VirtualTable,
  type VirtualTableColumnConfig,
} from "@dashframe/ui";
import { Chart } from "@dashframe/visualization";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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
  const { data: dataTables = [] } = useDataTables();

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

  // Get the data table for encoding resolution
  const dataTable = useMemo(() => {
    if (!insight?.baseTableId) return undefined;
    return dataTables.find((t) => t.id === insight.baseTableId);
  }, [insight, dataTables]);

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
  const {
    viewName: insightViewName,
    isReady: isInsightViewReady,
    error: insightViewError,
  } = useInsightView(insightForView);

  // Debug logging for E2E
  console.log("[VisualizationDisplay] insightView state:", {
    insightViewName,
    isInsightViewReady,
    insightViewError,
    insightForView: insightForView?.id,
  });

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

  // Resolve encoding from storage format (field:<uuid>, metric:<uuid>) to SQL expressions
  // This converts:
  // - field:<uuid> → column name (e.g., "category", "Product")
  // - metric:<uuid> → SQL aggregation (e.g., "sum(Quantity)", "count(*)")
  //
  // vgplot will perform the aggregation when rendering, so we pass the actual SQL expression,
  // not a pre-computed column alias. The insight view contains raw data (model mode),
  // and vgplot uses the aggregation expressions to build GROUP BY queries.
  const resolvedEncoding = useMemo((): ChartEncoding => {
    if (!activeViz?.encoding || !dataTable || !insight) {
      return {};
    }

    // Build resolution context with fields and metrics
    const context = {
      fields: dataTable.fields ?? [],
      metrics: insight.metrics ?? [],
    };

    // Resolve prefixed IDs to SQL expressions
    const resolved = resolveEncodingToSql(activeViz.encoding, context);

    return {
      ...resolved,
      xType: activeViz.encoding.xType,
      yType: activeViz.encoding.yType,
      // Pass through date transforms for temporal bar charts
      // These tell the renderer to use band scale (suppresses vgplot warning)
      xTransform: activeViz.encoding.xTransform,
      yTransform: activeViz.encoding.yTransform,
      // Include human-readable axis labels for chart display
      xLabel: resolved.x ? columnDisplayNames[resolved.x] : undefined,
      yLabel: resolved.y ? columnDisplayNames[resolved.y] : undefined,
      colorLabel: resolved.color
        ? columnDisplayNames[resolved.color]
        : undefined,
      sizeLabel: resolved.size ? columnDisplayNames[resolved.size] : undefined,
    };
  }, [activeViz, dataTable, insight, columnDisplayNames]);

  // Build column configs for VirtualTable to show human-readable headers
  const columnConfigs = useMemo((): VirtualTableColumnConfig[] => {
    return columns.map((col) => ({
      id: col.name,
      label: columnDisplayNames[col.name] ?? col.name,
    }));
  }, [columns, columnDisplayNames]);

  // Get human-readable display name for color encoding
  const colorDisplayName = useMemo(() => {
    if (!resolvedEncoding.color) return null;
    return columnDisplayNames[resolvedEncoding.color] ?? resolvedEncoding.color;
  }, [resolvedEncoding.color, columnDisplayNames]);

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
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Spinner size="lg" />
          </div>
          <p className="text-lg font-semibold text-foreground">
            Loading visualization...
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
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
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ChartIcon className="h-6 w-6" />
          </div>
          <p className="text-lg font-semibold text-foreground">
            No visualization yet
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
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
      <div ref={headerRef} className="border-b border-border/60 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xl font-semibold text-foreground">
              {activeViz.name}
            </p>
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">
                {totalCount.toLocaleString()} rows · {columns.length} columns
              </p>
              {colorDisplayName && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
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
