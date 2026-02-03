"use client";

import { useInsight } from "@dashframe/core";
import { InsightView } from "./InsightView";
import { LoadingView } from "./LoadingView";
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
    return <LoadingView />;
  }

  if (!insight) {
    return <NotFoundView type="insight" />;
  }

  return <InsightView insight={insight} />;
}
