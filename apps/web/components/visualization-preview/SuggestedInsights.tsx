"use client";

import { Button, Card } from "@dashframe/ui";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";
import dynamic from "next/dynamic";

// Simple Sparkles icon
const Sparkles = ({ className }: { className?: string }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.287 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.287L21 12l-5.8-1.9a2 2 0 0 1-1.287-1.287Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>
  </svg>
);

// Dynamically import VegaChart to avoid SSR issues
const VegaChart = dynamic<{ spec: any }>(
  () => import("@/components/visualizations/VegaChart").then(mod => mod.VegaChart),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[120px] bg-muted animate-pulse rounded" />
    ),
  }
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
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-4">Suggested insights</h3>
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground mb-4">
            No obvious chart suggestions for this data.
          </p>
          <p className="text-xs text-muted-foreground">
            You can still create a custom visualization below.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Suggested insights</h3>
        {onRegenerate && suggestions.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onRegenerate}>
            <Sparkles className="h-3 w-3 mr-2" />
            Regenerate
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {suggestions.map((suggestion) => (
          <Card key={suggestion.id} className="p-3 hover:border-primary transition-colors flex flex-col">
            {/* Chart Preview */}
            <div className="mb-3 rounded-lg overflow-hidden bg-transparent flex items-center justify-center">
              <VegaChart spec={suggestion.spec} />
            </div>

            {/* Chart Info */}
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium truncate">{suggestion.title}</h4>
                <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded flex-shrink-0 ml-2">
                  {suggestion.chartType}
                </span>
              </div>

              <div className="text-xs text-muted-foreground space-y-1 mb-3">
                <div className="flex items-start gap-1">
                  <span className="font-medium min-w-[20px]">X:</span>
                  <span className="truncate">{suggestion.encoding.x}</span>
                </div>
                <div className="flex items-start gap-1">
                  <span className="font-medium min-w-[20px]">Y:</span>
                  <span className="truncate">{formatYAxisLabel(suggestion.encoding.y)}</span>
                </div>
                {suggestion.encoding.color && (
                  <div className="flex items-start gap-1">
                    <span className="font-medium min-w-[20px]">Color:</span>
                    <span className="truncate">{suggestion.encoding.color}</span>
                  </div>
                )}
              </div>

              <Button
                size="sm"
                className="w-full mt-auto"
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
  // Common metric patterns that should show aggregation
  const metricKeywords = ["count", "sum", "total", "revenue", "sales", "amount", "units"];
  const lowerField = yField.toLowerCase();

  // Check if it's likely a metric
  const isMetric = metricKeywords.some(keyword => lowerField.includes(keyword));

  if (isMetric) {
    return `sum(${yField})`;
  }

  return yField;
}
