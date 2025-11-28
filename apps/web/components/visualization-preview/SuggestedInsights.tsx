"use client";

import { Button, Card } from "@dashframe/ui";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";
import dynamic from "next/dynamic";
import type { TopLevelSpec } from "vega-lite";

// Simple Sparkles icon
const Sparkles = ({ className }: { className?: string }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.287 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.287L21 12l-5.8-1.9a2 2 0 0 1-1.287-1.287Z" />
    <path d="M5 3v4" />
    <path d="M19 17v4" />
    <path d="M3 5h4" />
    <path d="M17 19h4" />
  </svg>
);

// Dynamically import VegaChart to avoid SSR issues
const VegaChart = dynamic<{ spec: TopLevelSpec; className?: string }>(
  () =>
    import("@/components/visualizations/VegaChart").then(
      (mod) => mod.VegaChart,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="bg-muted h-[120px] w-full animate-pulse rounded" />
    ),
  },
);

interface SuggestedInsightsProps {
  suggestions: ChartSuggestion[];
  onCreateChart: (suggestion: ChartSuggestion) => void;
  onRegenerate?: () => void;
}

export function SuggestedInsights({
  suggestions,
  onCreateChart,
  onRegenerate,
}: SuggestedInsightsProps) {
  if (suggestions.length === 0) {
    return (
      <div className="bg-card rounded-lg border p-4">
        <h3 className="text-muted-foreground mb-4 text-xs font-medium">
          Suggested insights
        </h3>
        <div className="py-8 text-center">
          <p className="text-muted-foreground mb-4 text-sm">
            No obvious chart suggestions for this data.
          </p>
          <p className="text-muted-foreground text-xs">
            You can still create a custom visualization below.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-muted-foreground text-xs font-medium">
          Suggested insights
        </h3>
        {onRegenerate && suggestions.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onRegenerate}>
            <Sparkles className="mr-2 h-3 w-3" />
            Regenerate
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {suggestions.map((suggestion) => (
          <Card
            key={suggestion.id}
            className="hover:border-primary flex flex-col p-3 transition-colors"
          >
            {/* Chart Preview */}
            <div className="mb-3 flex items-center justify-center overflow-hidden rounded-lg bg-transparent">
              <VegaChart
                spec={suggestion.spec}
                className="w-fit! flex-initial! mx-auto max-w-full"
              />
            </div>

            {/* Chart Info */}
            <div className="flex flex-1 flex-col">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="truncate text-sm font-medium">
                  {suggestion.title}
                </h4>
                <span className="bg-primary/10 text-primary ml-2 shrink-0 rounded px-2 py-0.5 text-xs">
                  {suggestion.chartType}
                </span>
              </div>

              <div className="text-muted-foreground mb-3 space-y-1 text-xs">
                <div className="flex items-start gap-1">
                  <span className="min-w-[20px] font-medium">X:</span>
                  <span className="truncate">{suggestion.encoding.x}</span>
                </div>
                <div className="flex items-start gap-1">
                  <span className="min-w-[20px] font-medium">Y:</span>
                  <span className="truncate">
                    {formatYAxisLabel(suggestion.encoding.y ?? "")}
                  </span>
                </div>
                {suggestion.encoding.color && (
                  <div className="flex items-start gap-1">
                    <span className="min-w-[20px] font-medium">Color:</span>
                    <span className="truncate">
                      {suggestion.encoding.color}
                    </span>
                  </div>
                )}
              </div>

              <Button
                size="sm"
                className="mt-auto w-full"
                onClick={() => onCreateChart(suggestion)}
              >
                Create
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Helper to format Y-axis labels with aggregation
function formatYAxisLabel(yField: string): string {
  // If the field is already in aggregated format (e.g., "sum(Revenue)"), return as-is
  if (/^(sum|avg|count|min|max|count_distinct)\(/i.test(yField)) {
    return yField;
  }

  // Common metric patterns that should show aggregation
  const metricKeywords = [
    "count",
    "sum",
    "total",
    "revenue",
    "sales",
    "amount",
    "units",
  ];
  const lowerField = yField.toLowerCase();

  // Check if it's likely a metric
  const isMetric = metricKeywords.some((keyword) =>
    lowerField.includes(keyword),
  );

  if (isMetric) {
    return `sum(${yField})`;
  }

  return yField;
}
