import { useQuery_experimental as useQuery } from "convex/react";
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { queryStatus } from "@/data/query-status";
import { DraftListItem } from "@/components/drafts/DraftListItem";
import { api } from "@dashframe/convex-backend/api";

import { Spinner } from "@wystack/ui-react";
import { OnboardingView } from "./_components/OnboardingView";

/**
 * Home Page
 *
 * Shows onboarding when no visualizations exist. Populated projects enter the
 * product through Reports so legacy peer collections do not bypass the
 * report-centered hierarchy.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const { data: visualizations = [], isLoading } = queryStatus(
    useQuery({ query: api.app.listVisualizations, args: {} }),
  );
  const { data: drafts = [] } = queryStatus(
    useQuery({ query: api.app.listDrafts, args: {} }),
  );

  const hasVisualizations = visualizations.length > 0;

  useEffect(() => {
    if (!isLoading && hasVisualizations) {
      void navigate({ to: "/dashboards", replace: true });
    }
  }, [hasVisualizations, isLoading, navigate]);

  if (isLoading || hasVisualizations) {
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
          {drafts.length > 0 ? (
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-semibold text-neutral-fg">
                Waiting for review
              </h2>
              <div className="space-y-3">
                {drafts.map((draft) => (
                  <DraftListItem key={draft.draftId} draft={draft} />
                ))}
              </div>
            </section>
          ) : null}

          <OnboardingView />
        </div>
      </main>
    </div>
  );
}
