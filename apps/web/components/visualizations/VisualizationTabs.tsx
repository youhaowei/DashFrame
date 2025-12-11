"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ItemSelector,
  type SelectableItem,
  type ItemAction,
} from "@dashframe/ui";
import { Database, Plus } from "@dashframe/ui/icons";
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
        metadata: frame?.rowCount
          ? `${frame.rowCount.toLocaleString()} rows`
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

  return (
    <ItemSelector
      title="Visualizations"
      items={vizItems}
      onItemSelect={setActive}
      actions={actions}
    />
  );
}
