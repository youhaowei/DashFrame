import { useQuery_experimental as useQuery } from "convex/react";
import { useEffect, useState } from "react";
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
  const [isOnboardingActive, setIsOnboardingActive] = useState(false);
  const dashboardsQuery = queryStatus(
    useQuery({ query: api.app.listDashboards, args: {} }),
  );
  const visualizationsQuery = queryStatus(
    useQuery({ query: api.app.listVisualizations, args: {} }),
  );
  const insightsQuery = queryStatus(
    useQuery({ query: api.app.listInsights, args: {} }),
  );
  const dataSourcesQuery = queryStatus(
    useQuery({ query: api.app.listDataSources, args: {} }),
  );
  const draftCountQuery = queryStatus(
    useQuery({ query: api.app.listDraftCount, args: {} }),
  );

  const dashboards = dashboardsQuery.data ?? [];
  const visualizations = visualizationsQuery.data ?? [];
  const insights = insightsQuery.data ?? [];
  const dataSources = dataSourcesQuery.data ?? [];
  const draftCount = draftCountQuery.data ?? 0;

  const isLoading =
    dashboardsQuery.isLoading ||
    visualizationsQuery.isLoading ||
    insightsQuery.isLoading ||
    dataSourcesQuery.isLoading ||
    draftCountQuery.isLoading;
  const hasLoadError =
    dashboardsQuery.isError ||
    visualizationsQuery.isError ||
    insightsQuery.isError ||
    dataSourcesQuery.isError ||
    draftCountQuery.isError;
  const hasProjectArtifacts =
    dashboards.length > 0 ||
    visualizations.length > 0 ||
    insights.length > 0 ||
    dataSources.length > 0 ||
    draftCount > 0;

  useEffect(() => {
    if (!isLoading && hasProjectArtifacts && !isOnboardingActive) {
      void navigate({ to: "/dashboards", replace: true });
    }
  }, [hasProjectArtifacts, isLoading, isOnboardingActive, navigate]);

  if (isLoading || (hasProjectArtifacts && !isOnboardingActive)) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-bg">
        <Spinner size="lg" className="text-neutral-fg-subtle" />
      </div>
    );
  }

  if (hasLoadError && !isOnboardingActive) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-bg">
        <p role="alert" className="text-sm text-neutral-fg-subtle">
          Couldn&apos;t determine whether this project is empty. Check your
          connection and try again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-neutral-bg">
      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-4xl px-6 py-12">
          <OnboardingView onActivityChange={setIsOnboardingActive} />
        </div>
      </main>
    </div>
  );
}
