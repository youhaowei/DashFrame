import { api } from "@/wystack/api";
import { useQuery } from "@wystack/client";
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
  const { data: visualizations = [], isLoading } = useQuery(
    api.listVisualizations,
    { args: {} },
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
          {/* Onboarding View - Show when no visualizations exist */}
          {!hasVisualizations && <OnboardingView />}

          {/* Home View - Show when visualizations exist */}
          {hasVisualizations && <HomeView />}
        </div>
      </main>
    </div>
  );
}
