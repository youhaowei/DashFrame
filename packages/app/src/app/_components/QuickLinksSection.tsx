import {
  useDataSources,
  useInsights,
  useVisualizations,
} from "@dashframe/core";
import { useNavigate } from "@tanstack/react-router";
import { ItemList } from "@wystack/ui";
import { ChartIcon, DatabaseIcon, SparklesIcon } from "@wystack/ui-icons";
import { useMemo } from "react";

/**
 * QuickLinksSection - Navigation links to main app sections
 *
 * Self-contained section that fetches counts via the WyStack server.
 */
export function QuickLinksSection() {
  const navigate = useNavigate();

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
        onSelect={(id) => navigate({ to: `/${id}` })}
        orientation="grid"
        gap={12}
      />
    </div>
  );
}
