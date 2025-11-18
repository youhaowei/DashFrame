"use client";

import Link from "next/link";
import { useMemo, useEffect, useState } from "react";
import { Sparkles, Plus } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";
import { cn } from "@/lib/utils";

interface VisualizationTabsProps {
  onCreateClick: () => void;
}

const visualizationLabels: Record<string, string> = {
  table: "Table",
  bar: "Bar",
  line: "Line",
  scatter: "Scatter",
  area: "Area",
};

export function VisualizationTabs({ onCreateClick }: VisualizationTabsProps) {
  const [isHydrated, setIsHydrated] = useState(false);
  const visualizationsMap = useVisualizationsStore(
    (state) => state.visualizations,
  );
  const dataFramesMap = useDataFramesStore((state) => state.dataFrames);
  const visualizations = useMemo(
    () => Array.from(visualizationsMap.values()),
    [visualizationsMap],
  );
  const activeId = useVisualizationsStore((state) => state.activeId);
  const setActive = useVisualizationsStore((state) => state.setActive);

  const vizSummaries = useMemo(() => {
    return visualizations.map((viz) => {
      const frame = dataFramesMap.get(viz.source.dataFrameId);
      return {
        ...viz,
        rowCount: frame?.metadata.rowCount,
      };
    });
  }, [visualizations, dataFramesMap]);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  if (!isHydrated) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/70 px-6 py-5 shadow-sm">
        <p className="text-sm text-muted-foreground">Preparing visualizations…</p>
      </div>
    );
  }

  if (visualizations.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-card/60 px-6 py-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">Create your first visualization</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload data or connect to Notion, then design charts tailored to your analysis.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button variant="outline" asChild size="sm">
            <Link href="/data-sources">Browse Data Sources</Link>
          </Button>
          <Button onClick={onCreateClick} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Create Visualization
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 px-4 py-4 shadow-sm sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
            <span>Visualizations</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground/70">
              {visualizations.length} active
            </span>
          </div>

          <Tabs
            value={activeId ?? undefined}
            onValueChange={setActive}
            className="min-w-0"
          >
            <div className="overflow-x-auto">
              <TabsList className="min-w-max bg-background/40">
                {vizSummaries.map((viz) => (
                  <TabsTrigger
                    key={viz.id}
                    value={viz.id}
                    className="min-w-[180px] justify-between gap-2 px-3 py-1.5 text-left"
                  >
                    <span className="truncate">{viz.name}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 text-[11px] font-semibold uppercase tracking-wide",
                        "bg-muted text-muted-foreground",
                      )}
                    >
                      {visualizationLabels[viz.visualizationType] ?? "Chart"}
                    </span>
                    {typeof viz.rowCount === "number" && (
                      <span className="text-[11px] text-muted-foreground">
                        {viz.rowCount.toLocaleString()} rows
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" asChild size="sm" className="w-full min-w-[150px] sm:w-auto">
            <Link href="/data-sources">Manage Data</Link>
          </Button>
          <Button onClick={onCreateClick} size="sm" className="w-full min-w-[150px] sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            New Visualization
          </Button>
        </div>
      </div>
    </div>
  );
}
