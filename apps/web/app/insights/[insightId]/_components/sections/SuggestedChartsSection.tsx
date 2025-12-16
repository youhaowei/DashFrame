"use client";

import { memo } from "react";
import { Section } from "@dashframe/ui";
import { SuggestedInsights } from "@/components/visualization-preview/SuggestedInsights";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";

interface SuggestedChartsSectionProps {
  tableName: string;
  suggestions: ChartSuggestion[];
  isLoading?: boolean;
  onCreateChart: (suggestion: ChartSuggestion) => void;
  onRegenerate: () => void;
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
}: SuggestedChartsSectionProps) {
  return (
    <Section
      title="Suggested charts"
      description={
        isLoading
          ? "Analyzing data..."
          : "Click a suggestion to create a visualization"
      }
    >
      {isLoading ? (
        // Loading skeleton
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        />
      )}
    </Section>
  );
});
