"use client";

import { useState, useMemo, useEffect, useLayoutEffect, useRef } from "react";
import { BarChart3, TableIcon, Layers, Surface, Toggle } from "@dashframe/ui";
import { useVisualizations, useInsights, useDataTables } from "@dashframe/core";
import type { Visualization } from "@dashframe/types";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import { VirtualTable } from "@dashframe/ui";
import { Chart } from "@dashframe/visualization";
import {
  computeInsightPreview,
  type PreviewResult,
} from "@/lib/insights/compute-preview";

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

  // Derive dataFrameId through relationship chain
  const dataFrameId = useMemo(() => {
    if (!activeViz) return undefined;
    const insight = insights.find((i) => i.id === activeViz.insightId);
    if (!insight) return undefined;
    const dataTable = dataTables.find((t) => t.id === insight.baseTableId);
    return dataTable?.dataFrameId;
  }, [activeViz, insights, dataTables]);

  const {
    data: dataFrameData,
    isLoading: isLoadingData,
    entry: dataFrameEntry,
  } = useDataFrameData(dataFrameId);

  // Get insight and dataTable for aggregation
  const insight = useMemo(() => {
    if (!activeViz) return undefined;
    return insights.find((i) => i.id === activeViz.insightId);
  }, [activeViz, insights]);

  const dataTable = useMemo(() => {
    if (!insight) return undefined;
    return dataTables.find((t) => t.id === insight.baseTableId);
  }, [insight, dataTables]);

  // Compute aggregated data if insight has metrics/dimensions
  const aggregatedPreview = useMemo<PreviewResult | null>(() => {
    if (!dataFrameData || !insight || !dataTable) return null;

    const selectedFields = insight.selectedFields ?? [];
    const metrics = insight.metrics ?? [];

    // If no aggregation config, return null (use raw data)
    if (selectedFields.length === 0 && metrics.length === 0) return null;

    return computeInsightPreview(
      insight,
      dataTable,
      dataFrameData,
      1000, // Allow more rows for visualization
    );
  }, [dataFrameData, insight, dataTable]);

  // Use aggregated data if available, otherwise raw data
  const displayData = useMemo(() => {
    if (aggregatedPreview) {
      return {
        rows: aggregatedPreview.dataFrame.rows,
        columns: aggregatedPreview.dataFrame.columns ?? [],
      };
    }
    return dataFrameData;
  }, [aggregatedPreview, dataFrameData]);

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
  const isDataReady = !!activeViz && !!displayData;

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

  const activeResolved = useMemo(() => {
    if (!activeViz || !displayData) return null;
    return { viz: activeViz, dataFrame: displayData, entry: dataFrameEntry };
  }, [activeViz, displayData, dataFrameEntry]);

  // Compute DuckDB table name from dataFrameId
  // Table naming convention: df_${dataFrameId.replace(/-/g, "_")}
  const tableName = useMemo(() => {
    if (!dataFrameId) return null;
    return `df_${dataFrameId.replace(/-/g, "_")}`;
  }, [dataFrameId]);

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

  // Show loading when not mounted, loading data, or have ID but no data yet
  const isWaitingForData =
    (visualizationId && !activeResolved) ||
    (visualizationId && !activeViz) ||
    isVizLoading;

  if (!isMounted || isLoadingData || isWaitingForData) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <Surface
          elevation="inset"
          className="w-full max-w-lg rounded-3xl p-10 text-center"
        >
          <div className="bg-primary/10 text-primary mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
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

  // No visualization or data selected
  if (!activeResolved) {
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

  const { viz, dataFrame, entry } = activeResolved;

  // Unified toggle view with Chart, Table, and Both options
  return (
    <div ref={containerRef} className="flex h-full flex-col">
      <div ref={headerRef} className="border-border/60 border-b px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-foreground text-xl font-semibold">{viz.name}</p>
            <div className="flex items-center gap-2">
              <p className="text-muted-foreground text-sm">
                {(entry?.rowCount ?? dataFrame.rows.length).toLocaleString()}{" "}
                rows · {entry?.columnCount ?? dataFrame.columns?.length ?? 0}{" "}
                columns
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
              variant="outline"
              size="sm"
              value={activeTab}
              onValueChange={setActiveTab}
              className="shrink-0"
              options={[
                {
                  value: "chart",
                  icon: <BarChart3 className="h-3.5 w-3.5" />,
                  label: "Chart",
                },
                {
                  value: "table",
                  icon: <TableIcon className="h-3.5 w-3.5" />,
                  label: "Table",
                },
                {
                  value: "both",
                  icon: <Layers className="h-3.5 w-3.5" />,
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
            visualizationType={viz.visualizationType}
            encoding={viz.encoding ?? {}}
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
              rows={dataFrame.rows}
              columns={dataFrame.columns}
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
              visualizationType={viz.visualizationType}
              encoding={viz.encoding ?? {}}
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
                rows={dataFrame.rows}
                columns={dataFrame.columns}
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
