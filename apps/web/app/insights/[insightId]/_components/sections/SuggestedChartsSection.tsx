"use client";

import { SuggestedInsights } from "@/components/visualization-preview/SuggestedInsights";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";
import { Section } from "@dashframe/ui";
import { memo } from "react";

interface SuggestedChartsSectionProps {
  tableName: string;
  suggestions: ChartSuggestion[];
  isLoading?: boolean;
  onCreateChart: (suggestion: ChartSuggestion) => void;
  onRegenerate: () => void;
  /** Whether the insight already has visualizations (uses muted buttons) */
  hasExistingVisualizations?: boolean;
}

/**
 * SuggestedChartsSection - Displays AI-generated chart suggestions
 *
 * Wraps the SuggestedInsights component with standardized Section layout.
 * Shows loading skeleton while analyzing data.
 *
 * Memoized to prevent re-renders when unrelated data changes.
 */
export const SuggestedChartsSection = memo(function SuggestedChartsSection({
  tableName,
  suggestions,
  isLoading = false,
  onCreateChart,
  onRegenerate,
  hasExistingVisualizations = false,
}: SuggestedChartsSectionProps) {
  const description = isLoading
    ? "Analyzing data..."
    : "Click a suggestion to create a visualization";

  return (
    <Section title="Suggested charts" description={description}>
      {isLoading ? (
        // Loading skeleton
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-border bg-card p-4 shadow-sm"
            >
              <div className="mb-3 h-32 animate-pulse rounded-xl bg-muted" />
              <div className="mb-2 h-5 w-3/4 animate-pulse rounded bg-muted-foreground/20" />
              <div className="h-4 w-1/2 animate-pulse rounded bg-muted-foreground/10" />
            </div>
          ))}
        </div>
      ) : (
        <SuggestedInsights
          tableName={tableName}
          suggestions={suggestions}
          onCreateChart={onCreateChart}
          onRegenerate={onRegenerate}
          secondaryActions={hasExistingVisualizations}
        />
      )}
    </Section>
  );
});
