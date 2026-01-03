"use client";

import { useVisualizations } from "@dashframe/core";
import { Spinner } from "@dashframe/ui";
import { OnboardingView } from "./_components/OnboardingView";
import { HomeView } from "./_components/HomeView";

/**
 * Home Page
 *
 * Shows onboarding flow when no visualizations exist,
 * or a dashboard overview when visualizations are present.
 */
export default function HomePage() {
  const { data: visualizations = [], isLoading } = useVisualizations();

  const hasVisualizations = visualizations.length > 0;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Spinner size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
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
