"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { VisualizationPreview } from "@/components/visualizations/VisualizationPreview";
import { useVisualizations } from "@dashframe/core";
import { ChartIcon } from "@dashframe/ui";
import { DashboardSection } from "./DashboardSection";

/**
 * RecentVisualizationsSection - Displays the 3 most recent visualizations
 *
 * Self-contained section that fetches its own data from Dexie.
 */
export function RecentVisualizationsSection() {
  const router = useRouter();

  const { data: visualizations = [] } = useVisualizations();

  const recentVisualizations = useMemo(() => {
    return [...visualizations]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 3)
      .map((viz) => ({
        id: viz.id,
        title: viz.name,
        subtitle: `Created ${new Date(viz.createdAt).toLocaleDateString(
          "en-US",
          { month: "short", day: "numeric" },
        )}`,
        preview: <VisualizationPreview visualization={viz} />,
      }));
  }, [visualizations]);

  return (
    <DashboardSection
      title="Recent Visualizations"
      icon={ChartIcon}
      viewAllHref="/visualizations"
      items={recentVisualizations}
      onItemSelect={(id) => router.push(`/visualizations/${id}`)}
      gap={16}
    />
  );
}
