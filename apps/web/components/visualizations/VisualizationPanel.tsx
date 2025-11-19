"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useVisualizationsStore, useDataFramesStore } from "@/lib/stores";
import { Card, CardContent } from "@/components/ui/card";
import type { TopLevelSpec } from "vega-lite";

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsHydrated(true);
  }, []);

  // Select primitive values to avoid re-render loops
  const activeViz = useVisualizationsStore((s) => s.getActive());
  const activeDataFrame = useDataFramesStore((s) =>
    activeViz ? s.get(activeViz.source.dataFrameId) : undefined,
  );

  // Combine into resolved object
  const resolved = useMemo(() => {
    if (!activeViz || !activeDataFrame) return null;
    return { viz: activeViz, dataFrame: activeDataFrame };
  }, [activeViz, activeDataFrame]);

  // Build full spec with data
  const hydratedResolved = isHydrated ? resolved : null;

  const fullSpec = useMemo<TopLevelSpec | null>(() => {
    if (!hydratedResolved) return null;

    return {
      ...hydratedResolved.viz.spec,
      data: { values: hydratedResolved.dataFrame.data.rows },
    } as TopLevelSpec;
  }, [hydratedResolved]);

  if (!hydratedResolved) {
    return (
      <Card className="flex min-h-[480px] flex-col gap-4 overflow-hidden shadow-lg">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Chart Preview</h2>
          </div>
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
            Upload a CSV or connect to Notion to create a visualization.
          </div>
        </CardContent>
      </Card>
    );
  }

  const { viz, dataFrame } = hydratedResolved;

  return (
    <Card className="flex min-h-[480px] flex-col gap-4 overflow-hidden shadow-lg">
      <CardContent className="flex flex-col gap-4 p-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">{viz.name}</h2>
            <p className="text-xs text-muted-foreground">
              {dataFrame.metadata.name} • Updated{" "}
              {new Intl.DateTimeFormat("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "UTC",
              }).format(dataFrame.metadata.timestamp)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Rows: {dataFrame.data.rows.length.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Chart */}
        {fullSpec && <VegaChart spec={fullSpec} />}

        {/* DataFrame Info */}
        <div className="space-y-2 text-xs text-muted-foreground">
          <div>
            <span className="font-semibold text-foreground">Columns:</span>{" "}
            {dataFrame.data.columns.length}
          </div>
          <div>
            <span className="font-semibold text-foreground">Detected types:</span>
            <ul className="mt-1 space-y-1">
              {dataFrame.data.columns.map((column) => (
                <li key={column.name} className="flex items-center gap-2">
                  <span className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
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
