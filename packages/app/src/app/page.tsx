import { useQuery_experimental as useQuery } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { DraftListItem } from "@/components/drafts/DraftListItem";
import { api } from "@dashframe/convex-backend/api";

import { Spinner } from "@wystack/ui-react";
import { HomeView } from "./_components/HomeView";
import { OnboardingView } from "./_components/OnboardingView";

/**
 * Home Page
 *
 * Shows onboarding flow when no visualizations exist,
 * or a dashboard overview when visualizations are present.
 */
export default function HomePage() {
  const { data: visualizations = [], isLoading } = queryStatus(
    useQuery({ query: api.app.listVisualizations, args: {} }),
  );
  const { data: drafts = [] } = queryStatus(
    useQuery({ query: api.app.listDrafts, args: {} }),
  );

  const hasVisualizations = visualizations.length > 0;

  if (isLoading) {
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

          {/* Onboarding View - Show when no visualizations exist */}
          {!hasVisualizations && <OnboardingView />}

          {/* Home View - Show when visualizations exist */}
          {hasVisualizations && <HomeView />}
        </div>
      </main>
    </div>
  );
}
