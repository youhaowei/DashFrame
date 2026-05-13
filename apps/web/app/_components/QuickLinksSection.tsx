"use client";

import { ChartIcon, DatabaseIcon, SparklesIcon } from "@stdui/icons";
import { ItemList } from "@stdui/react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import {
  useDataSources,
  useInsights,
  useVisualizations,
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
        icon: <ChartIcon className="h-4 w-4" />,
      },
      {
        id: "insights",
        title: "All Insights",
        subtitle: `${insights.length} total`,
        icon: <SparklesIcon className="h-4 w-4" />,
      },
      {
        id: "data-sources",
        title: "Data Sources",
        subtitle: `${dataSources.length} connected`,
        icon: <DatabaseIcon className="h-4 w-4" />,
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
