"use client";

import { useMemo, useState, useLayoutEffect } from "react";
import dynamic from "next/dynamic";
import { useVisualizationsStore } from "@/lib/stores";
import { useDataFrameData } from "@/hooks/useDataFrameData";
import { Card, CardContent, Surface } from "@dashframe/ui";
import type { TopLevelSpec } from "vega-lite";
import type { DataFrameColumn } from "@dashframe/dataframe";

// Dynamically import VegaChart with no SSR to prevent Set serialization issues
const VegaChart = dynamic(
  () => import("./VegaChart").then((mod) => mod.VegaChart),
  { ssr: false },
);

export function VisualizationPanel() {
  // Track hydration to avoid SSR/CSR mismatches with persisted stores
  const [isHydrated, setIsHydrated] = useState(false);

  // Set hydration flag after mount - this is a legitimate pattern for SSR hydration
  useLayoutEffect(() => {
    requestAnimationFrame(() => setIsHydrated(true));
  }, []);

  // Get active visualization
  const activeViz = useVisualizationsStore((s) => s.getActive());

  // Load DataFrame data asynchronously via DuckDB
  const { data, isLoading, error, entry } = useDataFrameData(
    activeViz?.source.dataFrameId,
  );

  // Build full spec with data
  const fullSpec = useMemo<TopLevelSpec | null>(() => {
    if (!isHydrated || !activeViz || !data) return null;

    return {
      ...activeViz.spec,
      data: { values: data.rows },
    } as TopLevelSpec;
  }, [isHydrated, activeViz, data]);

  // Empty state
  if (!activeViz) {
    return (
      <Card className="flex min-h-[480px] flex-col gap-4 overflow-hidden shadow-lg">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Chart Preview</h2>
          </div>
          <Surface
            elevation="inset"
            className="text-muted-foreground flex flex-1 items-center justify-center rounded-md text-sm"
          >
            Upload a CSV or connect to Notion to create a visualization.
          </Surface>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (isLoading || !isHydrated) {
    return (
      <Card className="flex min-h-[480px] flex-col gap-4 overflow-hidden shadow-lg">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="bg-muted h-6 w-48 animate-pulse rounded" />
              <div className="bg-muted mt-1 h-4 w-32 animate-pulse rounded" />
            </div>
          </div>
          <div className="bg-muted h-[300px] w-full animate-pulse rounded-md" />
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="flex min-h-[480px] flex-col gap-4 overflow-hidden shadow-lg">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">{activeViz.name}</h2>
          </div>
          <Surface
            elevation="inset"
            className="text-destructive flex flex-1 items-center justify-center rounded-md text-sm"
          >
            Failed to load data: {error}
          </Surface>
        </CardContent>
      </Card>
    );
  }

  // No data state
  if (!data) {
    return (
      <Card className="flex min-h-[480px] flex-col gap-4 overflow-hidden shadow-lg">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">{activeViz.name}</h2>
          </div>
          <Surface
            elevation="inset"
            className="text-muted-foreground flex flex-1 items-center justify-center rounded-md text-sm"
          >
            No data available for this visualization.
          </Surface>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex min-h-[480px] flex-col gap-4 overflow-hidden shadow-lg">
      <CardContent className="flex flex-col gap-4 p-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">{activeViz.name}</h2>
            <p className="text-muted-foreground text-xs">
              {entry?.name ?? "Unknown"} • Updated{" "}
              {entry?.createdAt
                ? new Intl.DateTimeFormat("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "UTC",
                  }).format(entry.createdAt)
                : "Unknown"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-xs">
              Rows: {data.rows.length.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Chart */}
        {fullSpec && <VegaChart spec={fullSpec} />}

        {/* DataFrame Info */}
        <div className="text-muted-foreground space-y-2 text-xs">
          <div>
            <span className="text-foreground font-semibold">Columns:</span>{" "}
            {data.columns.length}
          </div>
          <div>
            <span className="text-foreground font-semibold">
              Detected types:
            </span>
            <ul className="mt-1 space-y-1">
              {data.columns.map((column: DataFrameColumn) => (
                <li key={column.name} className="flex items-center gap-2">
                  <span className="bg-muted text-muted-foreground rounded px-2 py-1 text-[10px]">
                    {column.type}
                  </span>
                  <span className="text-foreground">{column.name}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
