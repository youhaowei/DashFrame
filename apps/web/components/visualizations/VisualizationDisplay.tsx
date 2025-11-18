"use client";

import { useState, useMemo, useEffect } from "react";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { TableView } from "./TableView";
import { VegaChart } from "./VegaChart";
import type { TopLevelSpec } from "vega-lite";
import type { Visualization } from "@/lib/stores/types";
import type { EnhancedDataFrame } from "@dash-frame/dataframe";

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

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Prevent hydration mismatch - always show empty state on server
  if (!isMounted || !activeResolved) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-gray-700">
            No visualization selected
          </p>
          <p className="mt-2 text-sm text-gray-500">
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
      <div className="h-full w-full overflow-auto p-6">
        <TableView dataFrame={dataFrame.data} />
      </div>
    );
  }

  // Chart view (with optional table below)
  const vegaSpec = buildVegaSpec(viz, dataFrame);

  return (
    <div className="flex h-full w-full flex-col overflow-auto">
      {/* Chart Section */}
      <div className="flex-shrink-0 p-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <VegaChart spec={vegaSpec} />
        </div>
      </div>

      {/* Table Toggle */}
      <div className="border-t border-gray-200 px-6 py-3">
        <button
          onClick={() => setShowTableWithChart(!showTableWithChart)}
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          {showTableWithChart ? "Hide" : "Show"} Data Table
        </button>
      </div>

      {/* Table Section (collapsible) */}
      {showTableWithChart && (
        <div className="flex-1 px-6 pb-6">
          <TableView dataFrame={dataFrame.data} />
        </div>
      )}
    </div>
  );
}
