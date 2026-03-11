import { useVisualizations } from "@dashframe/core";
import { Spinner } from "@stdui/react";
import { createFileRoute } from "@tanstack/react-router";

import { HomeView } from "@/app/_components/HomeView";
import { OnboardingView } from "@/app/_components/OnboardingView";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { data: visualizations = [], isLoading } = useVisualizations();

  const hasVisualizations = visualizations.length > 0;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-bg">
        <Spinner size="lg" className="text-neutral-fg-subtle" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-bg">
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-4xl px-6 py-12">
          {!hasVisualizations && <OnboardingView />}
          {hasVisualizations && <HomeView />}
        </div>
      </main>
    </div>
  );
}
