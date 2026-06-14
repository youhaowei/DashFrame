import { useNavigate } from "@tanstack/react-router";
import { SparklesIcon } from "@wystack/ui-icons";
import { useMemo } from "react";

import { useInsights } from "@dashframe/core";
import { DashboardSection } from "./DashboardSection";

/**
 * RecentInsightsSection - Displays the 3 most recent insights
 *
 * Self-contained section that fetches its own data via the WyStack server.
 */
export function RecentInsightsSection() {
  const navigate = useNavigate();

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
      onItemSelect={(id) => navigate({ to: `/insights/${id}` } as never)}
    />
  );
}
