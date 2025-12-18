"use client";

import { Card, Badge } from "@dashframe/ui";
import { Button } from "@dashframe/ui/primitives/button";
import type { ChartSuggestion } from "@/lib/visualizations/suggest-charts";
import { Chart, useVisualization } from "@dashframe/visualization";

/**
 * Extract raw field name from an encoding value (strips aggregation wrappers)
 */
function extractFieldName(value: string): string {
  const match = value.match(
    /^(?:sum|avg|count|min|max|count_distinct|dateMonth|dateYear|dateDay)\(([^)]+)\)$/i,
  );
  return match ? match[1] : value;
}

/**
 * EncodingRow - Displays a single encoding channel with optional "new" badge
 */
function EncodingRow({
  label,
  value,
  newFields,
}: {
  label: string;
  value?: string;
  newFields?: string[];
}) {
  if (!value) return null;

  const fieldName = extractFieldName(value);
  const isNew = newFields?.includes(fieldName);

  return (
    <div className="flex items-start gap-1">
      <span className="min-w-[40px] font-medium">{label}:</span>
      <span className="truncate">{value}</span>
      {isNew && (
        <Badge
          variant="outline"
          className="ml-1 shrink-0 border-amber-500/50 bg-amber-500/10 px-1 py-0 text-[10px] text-amber-600 dark:text-amber-400"
        >
          + new
        </Badge>
      )}
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

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
        {suggestions.map((suggestion) => (
          <Card
            key={suggestion.id}
            className="hover:border-primary flex flex-col p-3 transition-colors"
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
                    <div className="bg-muted flex h-full w-full items-center justify-center rounded-lg">
                      <span className="text-muted-foreground text-xs">
                        Loading chart...
                      </span>
                    </div>
                  }
                />
              ) : (
                <div className="bg-muted flex h-full w-full items-center justify-center rounded-lg">
                  <span className="text-muted-foreground text-xs">
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
                <span className="bg-primary/10 text-primary ml-2 shrink-0 rounded px-2 py-0.5 text-xs">
                  {suggestion.chartType}
                </span>
              </div>

              <div className="text-muted-foreground mb-3 space-y-1 text-xs">
                <EncodingRow
                  label="X"
                  value={suggestion.encoding.x}
                  newFields={suggestion.newFields}
                />
                <EncodingRow
                  label="Y"
                  value={formatYAxisLabel(suggestion.encoding.y ?? "")}
                  newFields={suggestion.newFields}
                />
                {suggestion.encoding.color && (
                  <EncodingRow
                    label="Color"
                    value={suggestion.encoding.color}
                    newFields={suggestion.newFields}
                  />
                )}
              </div>

              <Button
                size="sm"
                variant={secondaryActions ? "outline" : "default"}
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
