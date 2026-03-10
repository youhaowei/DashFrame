"use client";

import { useInsight } from "@dashframe/core";
import { Spinner } from "@stdui/react";
import { InsightView } from "./InsightView";
import { NotFoundView } from "./NotFoundView";

interface InsightPageContentProps {
  insightId: string;
}

/**
 * Insight page content - handles data fetching and rendering.
 *
 * This component is dynamically imported with ssr: false to ensure
 * IndexedDB operations only happen in the browser.
 */
export default function InsightPageContent({
  insightId,
}: InsightPageContentProps) {
  const { data: insight, isLoading } = useInsight(insightId);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Spinner size="lg" className="text-neutral-fg-subtle" />
          <p className="text-sm text-neutral-fg-subtle">Loading insight...</p>
        </div>
      </div>
    );
  }

  if (!insight) {
    return <NotFoundView type="insight" />;
  }

  return <InsightView insight={insight} />;
}
