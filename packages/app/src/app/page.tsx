import { useQuery_experimental as useQuery } from "convex/react";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { queryStatus } from "@/data/query-status";
import { api } from "@dashframe/convex-backend/api";

import { Spinner } from "@wystack/ui-react";
import { OnboardingView } from "./_components/OnboardingView";

/**
 * Home Page
 *
 * Shows onboarding when no artifacts exist. Populated projects enter the
 * product through Reports so legacy peer collections do not bypass the
 * report-centered hierarchy.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const { data: dashboards = [], isLoading: dashboardsLoading } = queryStatus(
    useQuery({ query: api.app.listDashboards, args: {} }),
  );
  const { data: visualizations = [], isLoading: visualizationsLoading } =
    queryStatus(useQuery({ query: api.app.listVisualizations, args: {} }));
  const { data: insights = [], isLoading: insightsLoading } = queryStatus(
    useQuery({ query: api.app.listInsights, args: {} }),
  );
  const { data: dataSources = [], isLoading: dataSourcesLoading } = queryStatus(
    useQuery({ query: api.app.listDataSources, args: {} }),
  );
  const { data: draftCount = 0, isLoading: draftCountLoading } = queryStatus(
    useQuery({ query: api.app.listDraftCount, args: {} }),
  );

  const isLoading =
    dashboardsLoading ||
    visualizationsLoading ||
    insightsLoading ||
    dataSourcesLoading ||
    draftCountLoading;
  const hasProjectArtifacts =
    dashboards.length > 0 ||
    visualizations.length > 0 ||
    insights.length > 0 ||
    dataSources.length > 0 ||
    draftCount > 0;

  useEffect(() => {
    if (!isLoading && hasProjectArtifacts) {
      void navigate({ to: "/dashboards", replace: true });
    }
  }, [hasProjectArtifacts, isLoading, navigate]);

  if (isLoading || hasProjectArtifacts) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-bg">
        <Spinner size="lg" className="text-neutral-fg-subtle" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-neutral-bg">
      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-4xl px-6 py-12">
          <OnboardingView />
        </div>
      </main>
    </div>
  );
}
