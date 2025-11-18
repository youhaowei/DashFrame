"use client";

import { useMemo, useEffect, useState } from "react";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface VisualizationTabsProps {
  onCreateClick: () => void;
}

export function VisualizationTabs({ onCreateClick }: VisualizationTabsProps) {
  const [isHydrated, setIsHydrated] = useState(false);
  const visualizationsMap = useVisualizationsStore(
    (state) => state.visualizations,
  );
  const visualizations = useMemo(
    () => Array.from(visualizationsMap.values()),
    [visualizationsMap],
  );
  const activeId = useVisualizationsStore((state) => state.activeId);
  const setActive = useVisualizationsStore((state) => state.setActive);

  // Wait for client-side hydration before rendering content from stores
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Don't render anything until hydrated to avoid hydration mismatch
  if (!isHydrated) {
    return (
      <div className="flex items-center gap-4 border-b border-border bg-card px-6 py-3">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // Empty state
  if (visualizations.length === 0) {
    return (
      <div className="flex items-center gap-4 border-b border-border bg-card px-6 py-3">
        <p className="text-sm text-muted-foreground">
          No visualizations yet. Create your first one to get started.
        </p>
        <Button onClick={onCreateClick} className="ml-auto" size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Create Visualization
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 border-b border-border bg-card px-6 py-2">
      <Tabs
        value={activeId ?? undefined}
        onValueChange={setActive}
      >
        <TabsList>
          {visualizations.map((viz) => (
            <TabsTrigger
              key={viz.id}
              value={viz.id}
            >
              {viz.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Button variant="secondary" onClick={onCreateClick} size="sm" className="ml-auto">
        <Plus className="h-4 w-4" />
        Create Visualization
      </Button>
    </div>
  );
}
