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
 *
 * The Stage owns this page's panel, background and scroll container, so nothing
 * here paints a surface or opens a second <main> — the page only owns the
 * reading column.
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
      <div className="flex h-full items-center justify-center">
        <p role="alert" className="text-sm text-neutral-fg-subtle">
          Couldn&apos;t determine whether this project is empty. Check your
          connection and try again.
        </p>
      </div>
    );
  }

  if (isLoading || (hasProjectArtifacts && !isOnboardingActive)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" className="text-neutral-fg-subtle" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <OnboardingView onActivityChange={setIsOnboardingActive} />
    </div>
  );
}
