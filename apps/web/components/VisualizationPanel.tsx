"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  useVisualizationsStore,
  useDataFramesStore,
} from "@/lib/stores";
import type { TopLevelSpec } from "vega-lite";

// Dynamically import VegaChart with no SSR to prevent Set serialization issues
const VegaChart = dynamic(
  () => import("./VegaChart").then((mod) => mod.VegaChart),
  { ssr: false },
);

export function VisualizationPanel() {
  // Track hydration to avoid SSR/CSR mismatches with persisted stores
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Select primitive values to avoid re-render loops
  const activeViz = useVisualizationsStore((s) => s.getActive());
  const activeDataFrame = useDataFramesStore((s) =>
    activeViz ? s.get(activeViz.source.dataFrameId) : undefined
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
      <section className="flex min-h-[480px] flex-col gap-4 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40 p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-slate-50">Chart Preview</h2>
        </div>
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-slate-700 text-sm text-slate-500">
          Upload a CSV or connect to Notion to create a visualization.
        </div>
      </section>
    );
  }

  const { viz, dataFrame } = hydratedResolved;

  return (
    <section className="flex min-h-[480px] flex-col gap-4 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40 p-4 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-slate-50">{viz.name}</h2>
          <p className="text-xs text-slate-400">
            {dataFrame.metadata.name} • Updated{" "}
            {new Intl.DateTimeFormat("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "UTC",
            }).format(dataFrame.metadata.timestamp)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            Rows: {dataFrame.data.rows.length.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Chart */}
      {fullSpec && <VegaChart spec={fullSpec} />}

      {/* DataFrame Info */}
      <div className="space-y-2 text-xs text-slate-400">
        <div>
          <span className="font-semibold text-slate-200">Columns:</span>{" "}
          {dataFrame.data.columns.length}
        </div>
        <div>
          <span className="font-semibold text-slate-200">Detected types:</span>
          <ul className="mt-1 space-y-1">
            {dataFrame.data.columns.map((column) => (
              <li key={column.name} className="flex items-center gap-2">
                <span className="rounded bg-slate-800 px-2 py-1 text-[10px] uppercase text-slate-300">
                  {column.type}
                </span>
                <span className="text-slate-200">{column.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
