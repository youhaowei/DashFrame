"use client";

import { use } from "react";
import { useInsightPageData } from "./_hooks/useInsightPageData";
import { InsightView, LoadingView, NotFoundView } from "./_components";

interface PageProps {
  params: Promise<{ insightId: string }>;
}

/**
 * Insight Page
 *
 * Adaptive page that shows different views based on state:
 * - Loading: Shows loading spinner during data hydration
 * - Not found: Shows error when insight or data table is missing
 * - Configured: Shows insight editor with configure and preview tabs
 */
export default function InsightPage({ params }: PageProps) {
  const { insightId } = use(params);

  const {
    isLoading,
    insight,
    dataTableInfo,
    visualizations,
    isConfigured,
    selectedFields,
    aggregatedPreview,
    updateInsight,
  } = useInsightPageData(insightId);

  // Loading state during hydration
  if (isLoading) {
    return <LoadingView />;
  }

  // Insight not found
  if (!insight) {
    return <NotFoundView type="insight" />;
  }

  // Data table not found
  if (!dataTableInfo) {
    return <NotFoundView type="dataTable" />;
  }

  // Main view
  return (
    <InsightView
      insightId={insightId}
      insight={insight}
      dataTableInfo={dataTableInfo}
      visualizations={visualizations ?? []}
      isConfigured={isConfigured}
      selectedFields={selectedFields}
      aggregatedPreview={aggregatedPreview}
      onNameChange={(name) => updateInsight(insightId, { name })}
    />
  );
}
