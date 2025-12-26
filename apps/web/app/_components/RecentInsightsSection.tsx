"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { SparklesIcon } from "@dashframe/ui";

import { DashboardSection } from "./DashboardSection";
import { useInsights } from "@dashframe/core";

/**
 * RecentInsightsSection - Displays the 3 most recent insights
 *
 * Self-contained section that fetches its own data from Dexie.
 */
export function RecentInsightsSection() {
  const router = useRouter();

  const { data: insights = [] } = useInsights();

  const recentInsights = useMemo(() => {
    return [...insights]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 3)
      .map((insight) => ({
        id: insight.id,
        title: insight.name,
        subtitle: `${insight.metrics?.length || 0} metric${insight.metrics?.length !== 1 ? "s" : ""}`,
        badge: insight.selectedFields.length
          ? `${insight.selectedFields.length} fields`
          : undefined,
      }));
  }, [insights]);

  return (
    <DashboardSection
      title="Recent Insights"
      icon={SparklesIcon}
      viewAllHref="/insights"
      items={recentInsights}
      onItemSelect={(id) => router.push(`/insights/${id}`)}
    />
  );
}
