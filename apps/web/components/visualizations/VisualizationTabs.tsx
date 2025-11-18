"use client";

import { useMemo, useState, useEffect } from "react";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";

interface VisualizationTabsProps {
  onCreateClick: () => void;
}

export function VisualizationTabs({ onCreateClick }: VisualizationTabsProps) {
  const [isMounted, setIsMounted] = useState(false);
  const visualizationsMap = useVisualizationsStore(
    (state) => state.visualizations,
  );
  const visualizations = useMemo(
    () => Array.from(visualizationsMap.values()),
    [visualizationsMap],
  );
  const activeId = useVisualizationsStore((state) => state.activeId);
  const setActive = useVisualizationsStore((state) => state.setActive);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Prevent hydration mismatch - always show empty state on server
  if (!isMounted || visualizations.length === 0) {
    return (
      <div className="flex items-center gap-4 border-b border-gray-200 bg-white px-6 py-3">
        <div className="text-sm text-gray-500">
          No visualizations yet. Create your first one to get started.
        </div>
        <button
          onClick={onCreateClick}
          className="ml-auto rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Create Visualization
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-6">
      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {visualizations.map((viz) => (
          <button
            key={viz.id}
            onClick={() => setActive(viz.id)}
            className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeId === viz.id
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900"
            }`}
          >
            {viz.name}
          </button>
        ))}
      </div>

      {/* Create Button */}
      <button
        onClick={onCreateClick}
        className="ml-auto rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        + Create
      </button>
    </div>
  );
}
