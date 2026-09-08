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
  const presenceQuery = queryStatus(
    useQuery({ query: api.app.workspaceArtifactPresence, args: {} }),
  );

  const isLoading = presenceQuery.isLoading;
  const hasLoadError = presenceQuery.isError;
  const hasProjectArtifacts = presenceQuery.data ?? false;
  useEffect(() => {
    if (
      !isLoading &&
      !hasLoadError &&
      hasProjectArtifacts &&
      !isOnboardingActive
    ) {
      void navigate({ to: "/dashboards", replace: true });
    }
  }, [
    hasLoadError,
    hasProjectArtifacts,
    isLoading,
    isOnboardingActive,
    navigate,
  ]);

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

  if (isLoading || (hasProjectArtifacts && !isOnboardingActive)) {
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
          <OnboardingView onActivityChange={setIsOnboardingActive} />
        </div>
      </main>
    </div>
  );
}
