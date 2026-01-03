"use client";

import { Card } from "@dashframe/ui";
import { Button } from "@dashframe/ui/primitives/button";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";
import { Chart, useVisualization } from "@dashframe/visualization";

/**
 * EncodingRow - Displays a single encoding channel
 */
function EncodingRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;

  return (
    <div className="flex items-start gap-1">
      <span className="min-w-[40px] font-medium">{label}:</span>
      <span className="truncate">{value}</span>
    </div>
  );
}

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

interface SuggestedInsightsProps {
  /** DuckDB table name to render charts from */
  tableName: string;
  suggestions: ChartSuggestion[];
  onCreateChart: (suggestion: ChartSuggestion) => void;
  onRegenerate?: () => void;
  /** When true, uses muted button style (for configured insights with existing visualizations) */
  secondaryActions?: boolean;
}

/**
 * Displays chart suggestions as preview cards.
 * Uses Chart to render previews directly from DuckDB tables.
 *
 * Note: Suggestions are temporary insight configurations (encoding + chartType),
 * not full visualization specs. The actual rendering queries DuckDB directly.
 */
export function SuggestedInsights({
  tableName,
  suggestions,
  onCreateChart,
  onRegenerate,
  secondaryActions = false,
}: SuggestedInsightsProps) {
  const { isReady: isVizReady } = useVisualization();

  if (suggestions.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-4 text-xs font-medium text-muted-foreground">
          Suggested insights
        </h3>
        <div className="py-8 text-center">
          <p className="mb-4 text-sm text-muted-foreground">
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
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">
          Suggested insights
        </h3>
        {onRegenerate && suggestions.length > 0 && (
          <Button variant="text" size="sm" onClick={onRegenerate}>
            <Sparkles className="mr-2 h-3 w-3" />
            Regenerate
          </Button>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
        {suggestions.map((suggestion) => (
          <Card
            key={suggestion.id}
            className="flex flex-col p-3 transition-colors hover:border-primary"
          >
            {/* Chart Preview */}
            <div className="mb-3 h-[120px] w-full overflow-hidden rounded-lg bg-transparent">
              {isVizReady ? (
                <Chart
                  tableName={tableName}
                  visualizationType={suggestion.chartType}
                  encoding={suggestion.encoding}
                  width="container"
                  height={120}
                  preview
                  className="h-[120px] w-full"
                  fallback={
                    <div className="flex h-full w-full items-center justify-center rounded-lg bg-muted">
                      <span className="text-xs text-muted-foreground">
                        Loading chart...
                      </span>
                    </div>
                  }
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center rounded-lg bg-muted">
                  <span className="text-xs text-muted-foreground">
                    Initializing...
                  </span>
                </div>
              )}
            </div>

            {/* Chart Info */}
            <div className="flex flex-1 flex-col">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="truncate text-sm font-medium">
                  {suggestion.title}
                </h4>
                <span className="ml-2 shrink-0 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  {suggestion.chartType}
                </span>
              </div>

              <div className="mb-3 space-y-1 text-xs text-muted-foreground">
                <EncodingRow
                  label="X"
                  value={suggestion.encoding.xLabel ?? suggestion.encoding.x}
                />
                <EncodingRow
                  label="Y"
                  value={suggestion.encoding.yLabel ?? suggestion.encoding.y}
                />
                {suggestion.encoding.color && (
                  <EncodingRow
                    label="Color"
                    value={
                      suggestion.encoding.colorLabel ??
                      suggestion.encoding.color
                    }
                  />
                )}
              </div>

              <Button
                size="sm"
                variant={secondaryActions ? "outlined" : "filled"}
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
