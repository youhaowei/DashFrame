"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Sparkles, Plus, Database } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  ItemSelector,
  type SelectableItem,
  type ItemAction,
} from "@/components/shared/ItemSelector";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useDataFramesStore } from "@/lib/stores/dataframes-store";

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
  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsHydrated(true));
    return () => cancelAnimationFrame(frame);
  }, []);
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

  const vizItems: SelectableItem[] = useMemo(() => {
    return visualizations.map((viz) => {
      const frame = dataFramesMap.get(viz.source.dataFrameId);
      const isActive = viz.id === activeId;
      return {
        id: viz.id,
        label: viz.name,
        active: isActive,
        badge: visualizationLabels[viz.visualizationType] ?? "Chart",
        metadata: frame?.metadata.rowCount
          ? `${frame.metadata.rowCount.toLocaleString()} rows`
          : undefined,
      };
    });
  }, [visualizations, dataFramesMap, activeId]);

  const actions: ItemAction[] = useMemo(
    () => [
      {
        label: "Manage Data",
        variant: "outline",
        href: "/data-sources",
        icon: Database,
        tooltip: "Open data sources",
      },
      {
        label: "New Visualization",
        onClick: onCreateClick,
        icon: Plus,
      },
    ],
    [onCreateClick],
  );

  if (!isHydrated) {
    return (
      <div className="border-border/60 bg-card/70 rounded-2xl border px-6 py-5 shadow-sm">
        <p className="text-muted-foreground text-sm">
          Preparing visualizations…
        </p>
      </div>
    );
  }

  if (visualizations.length === 0) {
    return (
      <div className="border-border/70 bg-card/60 rounded-2xl border border-dashed px-6 py-8 text-center shadow-sm">
        <div className="bg-primary/15 text-primary mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <Sparkles className="h-5 w-5" />
        </div>
        <h2 className="text-foreground text-lg font-semibold">
          Create your first visualization
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Upload data or connect to Notion, then design charts tailored to your
          analysis.
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
    <ItemSelector
      title="Visualizations"
      items={vizItems}
      onItemSelect={setActive}
      actions={actions}
    />
  );
}
