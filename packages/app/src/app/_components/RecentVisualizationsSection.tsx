import { useQuery_experimental as useQuery } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { useMemo } from "react";

import { VisualizationPreview } from "@/components/visualizations/VisualizationPreview";
import { api } from "@dashframe/convex-backend/api";
import { useNavigate } from "@tanstack/react-router";

import { ChartIcon } from "@wystack/ui-react/icons";
import { DashboardSection } from "./DashboardSection";

/**
 * RecentVisualizationsSection - Displays the 3 most recent visualizations
 *
 * Self-contained section that fetches its own data via the Convex backend.
 */
export function RecentVisualizationsSection() {
  const navigate = useNavigate();

  const { data: visualizations = [] } = queryStatus(
    useQuery({ query: api.app.listVisualizations, args: {} }),
  );

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
      onItemSelect={(id) => navigate({ to: `/visualizations/${id}` })}
      gap={16}
    />
  );
}
