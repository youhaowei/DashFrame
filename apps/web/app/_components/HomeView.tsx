"use client";

import { useMemo } from "react";

import { RecentVisualizationsSection } from "./RecentVisualizationsSection";
import { RecentInsightsSection } from "./RecentInsightsSection";
import { QuickLinksSection } from "./QuickLinksSection";
import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useInsightsStore } from "@/lib/stores/insights-store";
import { useDataSourcesStore } from "@/lib/stores/data-sources-store";
import { useStoreQuery } from "@/hooks/useStoreQuery";
import type { DataSource } from "@/lib/stores/types";

/**
 * HomeView - Main view for returning users with existing data
 *
 * Displays a welcome header with stats and sections for recent
 * visualizations, insights, and quick navigation links.
 */
export function HomeView() {
  const { data: visualizations } = useStoreQuery(
    useVisualizationsStore,
    (state) => state.getAll(),
  );
  const { data: insights } = useStoreQuery(useInsightsStore, (state) =>
    state.getAll(),
  );
  const { data: dataSources } = useStoreQuery(useDataSourcesStore, (state) =>
    state.getAll(),
  );

  const totalTables = useMemo(() => {
    return dataSources.reduce(
      (acc: number, ds: DataSource) => acc + (ds.dataTables?.size || 0),
      0,
    );
  }, [dataSources]);

  return (
    <>
      {/* Welcome Header */}
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold">Welcome back to DashFrame</h1>
        <p className="text-muted-foreground">
          {visualizations.length} visualization
          {visualizations.length !== 1 ? "s" : ""} · {insights.length} insight
          {insights.length !== 1 ? "s" : ""} · {dataSources.length} data source
          {dataSources.length !== 1 ? "s" : ""} · {totalTables} table
          {totalTables !== 1 ? "s" : ""}
        </p>
      </div>

      <RecentVisualizationsSection />
      <RecentInsightsSection />
      <QuickLinksSection />
    </>
  );
}
