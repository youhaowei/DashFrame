"use client";

import { useVisualizationsStore } from "@/lib/stores/visualizations-store";
import { useStoreQuery } from "@/hooks/useStoreQuery";
import { OnboardingView } from "./_components/OnboardingView";
import { HomeView } from "./_components/HomeView";

/**
 * Home Page
 *
 * Shows onboarding flow when no visualizations exist,
 * or a dashboard overview when visualizations are present.
 */
export default function HomePage() {
  const { data: visualizations } = useStoreQuery(
    useVisualizationsStore,
    (state) => state.getAll(),
  );

  const hasVisualizations = visualizations.length > 0;

  return (
    <div className="bg-background flex h-screen flex-col">
      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-4xl px-6 py-12">
          {/* Onboarding View - Show when no visualizations exist */}
          {!hasVisualizations && <OnboardingView />}

          {/* Home View - Show when visualizations exist */}
          {hasVisualizations && <HomeView />}
        </div>
      </main>
    </div>
  );
}
