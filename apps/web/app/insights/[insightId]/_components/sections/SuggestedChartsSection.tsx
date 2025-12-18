"use client";

import { memo, useMemo } from "react";
import { Section } from "@dashframe/ui";
import { SuggestedInsights } from "@/components/visualization-preview/SuggestedInsights";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";

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
  // Check if any suggestions would add new fields
  const hasNewFields = useMemo(
    () => suggestions.some((s) => s.newFields && s.newFields.length > 0),
    [suggestions],
  );

  // Build contextual description
  const description = useMemo(() => {
    if (isLoading) return "Analyzing data...";
    if (hasNewFields) {
      return 'Fields marked with "+ new" will be added to your insight configuration';
    }
    return "Click a suggestion to create a visualization";
  }, [isLoading, hasNewFields]);

  return (
    <Section title="Suggested charts" description={description}>
      {isLoading ? (
        // Loading skeleton
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="border-border bg-card rounded-2xl border p-4 shadow-sm"
            >
              <div className="bg-muted mb-3 h-32 animate-pulse rounded-xl" />
              <div className="bg-muted-foreground/20 mb-2 h-5 w-3/4 animate-pulse rounded" />
              <div className="bg-muted-foreground/10 h-4 w-1/2 animate-pulse rounded" />
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
