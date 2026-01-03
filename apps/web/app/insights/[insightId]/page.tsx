"use client";

import { useInsight } from "@dashframe/core";
import { use } from "react";
import { InsightView, LoadingView, NotFoundView } from "./_components";

interface PageProps {
  params: Promise<{ insightId: string }>;
}

/**
 * Insight Page
 *
 * Minimal page component that only handles routing.
 * Data fetching is handled by InsightView itself.
 */
export default function InsightPage({ params }: PageProps) {
  const { insightId } = use(params);
  const { data: insight, isLoading } = useInsight(insightId);

  if (isLoading) {
    return <LoadingView />;
  }

  if (!insight) {
    return <NotFoundView type="insight" />;
  }

  return <InsightView insight={insight} />;
}
