"use client";

import {
  useVisualizations,
  useInsights,
  useDataSources,
  useDataTables,
} from "@dashframe/core";
import { RecentVisualizationsSection } from "./RecentVisualizationsSection";
import { RecentInsightsSection } from "./RecentInsightsSection";
import { QuickLinksSection } from "./QuickLinksSection";

/**
 * HomeView - Main view for returning users with existing data
 *
 * Displays a welcome header with stats and sections for recent
 * visualizations, insights, and quick navigation links.
 */
export function HomeView() {
  const { data: visualizations = [] } = useVisualizations();
  const { data: insights = [] } = useInsights();
  const { data: dataSources = [] } = useDataSources();
  const { data: dataTables = [] } = useDataTables();

  const totalTables = dataTables.length;

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
