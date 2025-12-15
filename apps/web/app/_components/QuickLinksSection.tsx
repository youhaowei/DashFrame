"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Sparkles, Database, ItemList } from "@dashframe/ui";

import {
  useVisualizations,
  useInsights,
  useDataSources,
} from "@dashframe/core";

/**
 * QuickLinksSection - Navigation links to main app sections
 *
 * Self-contained section that fetches counts from Dexie.
 */
export function QuickLinksSection() {
  const router = useRouter();

  const { data: visualizations = [] } = useVisualizations();
  const { data: insights = [] } = useInsights();
  const { data: dataSources = [] } = useDataSources();

  const quickLinks = useMemo(
    () => [
      {
        id: "visualizations",
        title: "All Visualizations",
        subtitle: `${visualizations.length} total`,
        icon: BarChart3,
      },
      {
        id: "insights",
        title: "All Insights",
        subtitle: `${insights.length} total`,
        icon: Sparkles,
      },
      {
        id: "data-sources",
        title: "Data Sources",
        subtitle: `${dataSources.length} connected`,
        icon: Database,
      },
    ],
    [visualizations.length, insights.length, dataSources.length],
  );

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Quick Links</h2>
      <ItemList
        items={quickLinks}
        onSelect={(id) => router.push(`/${id}`)}
        orientation="grid"
        gap={12}
      />
    </div>
  );
}
