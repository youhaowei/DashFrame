"use client";

import { useMemo, useCallback, memo } from "react";
import { cn } from "@dashframe/ui";
import { Button } from "@dashframe/ui/primitives/button";
import { Sparkles } from "@dashframe/ui/icons";
import {
  BarChart,
  BarChartHorizontal,
  LineChart,
  AreaChart,
  ScatterChart,
  type LucideIcon,
} from "@dashframe/ui/icons";
import type { VisualizationType, Field } from "@dashframe/types";
import type { ColumnAnalysis } from "@dashframe/engine-browser";
import type { Insight } from "@/lib/stores/types";
import {
  suggestForAllChartTypes,
  getChartTypeUnavailableReason,
  type ChartSuggestion,
} from "@/lib/visualizations/suggest-charts";
import { Chart } from "@dashframe/visualization";

/**
 * Configuration for each chart type including display info, icon, and usage hints.
 */
export const CHART_TYPE_CONFIG: Record<
  VisualizationType,
  { label: string; icon: LucideIcon; description: string; hint: string }
> = {
  bar: {
    label: "Bar",
    icon: BarChart,
    description: "Compare categories",
    hint: "Best for comparing values across categories (e.g., sales by region). Requires categorical X and numeric Y.",
  },
  barHorizontal: {
    label: "Horizontal bar",
    icon: BarChartHorizontal,
    description: "Compare categories horizontally",
    hint: "Good for long category labels or ranking comparisons with many categories.",
  },
  line: {
    label: "Line",
    icon: LineChart,
    description: "Show trends over time",
    hint: "Best for time series. Use when X-axis is temporal to see how values change over time.",
  },
  area: {
    label: "Area",
    icon: AreaChart,
    description: "Show cumulative trends",
    hint: "Like line charts but emphasizes volume. Good for cumulative totals over time.",
  },
  scatter: {
    label: "Scatter",
    icon: ScatterChart,
    description: "Show correlations",
    hint: "Explore relationships between two numeric variables. Best for <5K points.",
  },
  hexbin: {
    label: "Hexbin",
    icon: ScatterChart,
    description: "Density binning for large datasets",
    hint: "Aggregates points into hex cells by density. Use for 5K+ points where scatter overplots.",
  },
  heatmap: {
    label: "Heatmap",
    icon: ScatterChart,
    description: "Smooth density visualization",
    hint: "Shows continuous density distribution. Good for finding clusters in large datasets.",
  },
  raster: {
    label: "Raster",
    icon: ScatterChart,
    description: "Pixel aggregation for huge datasets",
    hint: "Fastest for massive datasets (100K+). Each pixel represents aggregated data.",
  },
};

/**
 * Ordered list of chart types for display.
 */
export const CHART_TYPES: VisualizationType[] = [
  "bar",
  "line",
  "area",
  "scatter",
  "hexbin",
  "barHorizontal",
];

/** Height of the chart preview area in pixels */
const PREVIEW_HEIGHT = 140;

/**
 * Internal data structure for chart type cards.
 * Used to hold computed state for each chart type.
 */
interface ChartTypeItem {
  chartType: VisualizationType;
  suggestion: ChartSuggestion | null;
  /** When string, shows as reason; when true/false, indicates availability */
  disabled?: boolean | string;
}

interface ChartTypeCardProps {
  chartType: VisualizationType;
  suggestion: ChartSuggestion | null;
  tableName: string;
  /** When string, shows as reason; when true, just disables */
  disabled?: boolean | string;
  /** Show loading skeleton for chart preview */
  isLoading?: boolean;
  /** Callback when user clicks "Use suggestion" button */
  onUseSuggestion: () => void;
  /** Callback when user clicks "Create custom" button */
  onCreateCustom: () => void;
}

/** Get subtitle text for chart type card */
function getCardSubtitle(
  showLoading: boolean,
  hasSuggestion: boolean,
  suggestion: ChartSuggestion | null,
  description: string,
): string {
  if (showLoading) return "Loading preview...";
  if (hasSuggestion && suggestion) return suggestion.title;
  return description;
}

/** Format encoding spec for display */
function formatEncodingSpec(suggestion: ChartSuggestion): string {
  const parts: string[] = [];
  const enc = suggestion.encoding;
  if (enc.xLabel) parts.push(`X: ${enc.xLabel}`);
  if (enc.yLabel) parts.push(`Y: ${enc.yLabel}`);
  if (enc.colorLabel) parts.push(`Color: ${enc.colorLabel}`);
  return parts.join(" · ");
}

/** Render the preview content for a chart type card - memoized to prevent re-renders */
const ChartTypeCardPreview = memo(function ChartTypeCardPreview({
  showLoadingSkeleton,
  hasSuggestion,
  suggestion,
  tableName,
  chartType,
  Icon,
  disabledReason,
}: {
  showLoadingSkeleton: boolean;
  hasSuggestion: boolean;
  suggestion: ChartSuggestion | null;
  tableName: string;
  chartType: VisualizationType;
  Icon: typeof BarChart;
  disabledReason: string | null;
}) {
  if (showLoadingSkeleton) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="bg-muted h-full w-full animate-pulse" />
      </div>
    );
  }

  if (hasSuggestion && suggestion) {
    return (
      <Chart
        tableName={tableName}
        visualizationType={chartType}
        encoding={suggestion.encoding}
        height={PREVIEW_HEIGHT}
        preview
        className="h-full w-full"
      />
    );
  }

  // Placeholder for unavailable/unconfigured chart types
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      <Icon className="text-muted-foreground/40 h-10 w-10" />
      <span className="text-muted-foreground/60 text-sm">
        {disabledReason ?? "Configure manually"}
      </span>
    </div>
  );
});

/**
 * Chart type card with preview and explicit action buttons.
 * Shows a chart preview or placeholder icon with consistent sizing.
 * When disabled, shows grayed out state with explanation.
 * When loading AND has a suggestion, shows animated skeleton for the preview.
 *
 * Action buttons:
 * - "Use suggestion" - creates chart with auto-suggested encoding (only when suggestion exists)
 * - "Create custom" - creates chart with empty encoding for manual configuration
 *
 * Optimization: Cards without suggestions show placeholder icons immediately,
 * even during loading. Only cards with actual previews show loading skeletons.
 */
const ChartTypeCard = memo(function ChartTypeCard({
  chartType,
  suggestion,
  tableName,
  disabled,
  isLoading = false,
  onUseSuggestion,
  onCreateCustom,
}: ChartTypeCardProps) {
  const config = CHART_TYPE_CONFIG[chartType];
  const Icon = config.icon;
  const hasSuggestion = suggestion !== null;
  const disabledReason = typeof disabled === "string" ? disabled : null;

  // Only show loading skeleton if we have a suggestion that will render a preview
  const showLoadingSkeleton = isLoading && hasSuggestion;

  // Card is disabled if explicitly disabled OR if loading with a suggestion
  const isDisabled = Boolean(disabled) || showLoadingSkeleton;

  return (
    <div
      className={cn(
        "group flex w-full flex-col overflow-hidden rounded-lg border",
        "transition-[border-color,opacity] duration-150",
        isDisabled ? "border-border/40 opacity-50" : "border-border/60",
      )}
    >
      {/* Preview Section */}
      <div
        className="bg-muted/30 w-full overflow-hidden"
        style={{ height: `${PREVIEW_HEIGHT}px` }}
      >
        <ChartTypeCardPreview
          showLoadingSkeleton={showLoadingSkeleton}
          hasSuggestion={hasSuggestion}
          suggestion={suggestion}
          tableName={tableName}
          chartType={chartType}
          Icon={Icon}
          disabledReason={disabledReason}
        />
      </div>

      {/* Content Section */}
      <div className="flex flex-1 flex-col p-4">
        <p
          className={cn(
            "text-sm font-medium",
            isDisabled ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {config.label}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          {getCardSubtitle(
            showLoadingSkeleton,
            hasSuggestion,
            suggestion,
            config.description,
          )}
        </p>

        {/* Show encoding spec when suggestion exists, or hint when it doesn't */}
        {hasSuggestion && suggestion ? (
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            {formatEncodingSpec(suggestion)}
          </p>
        ) : (
          <p className="text-muted-foreground/70 mt-2 text-xs leading-relaxed">
            {config.hint}
          </p>
        )}

        {/* Action Buttons - stack vertically when space is limited */}
        <div className="mt-3 flex flex-col gap-2">
          {hasSuggestion && (
            <Button
              variant="default"
              size="sm"
              onClick={onUseSuggestion}
              disabled={isDisabled}
            >
              Use suggestion
            </Button>
          )}
          <Button
            variant={hasSuggestion ? "outline" : "default"}
            size="sm"
            onClick={onCreateCustom}
            disabled={isDisabled}
          >
            Create custom
          </Button>
        </div>
      </div>
    </div>
  );
});

export interface ChartTypePickerProps {
  /** DuckDB table name for chart preview */
  tableName: string;
  /** Insight object for suggestion generation */
  insight: Insight;
  /** Column analysis from DuckDB */
  columnAnalysis: ColumnAnalysis[];
  /** Total row count */
  rowCount: number;
  /** Field definitions */
  fieldMap: Record<string, Field>;
  /** Existing field names in the insight */
  existingFields: string[];
  /** Callback when a chart is created */
  onCreateChart: (suggestion: ChartSuggestion) => void;
  /** Number of grid columns (default: 3) */
  gridColumns?: number;
  /** Show loading state for all chart previews */
  isLoading?: boolean;
  /** Seed for shuffling chart suggestions */
  suggestionSeed?: number;
  /** Callback to regenerate suggestions with a new seed */
  onRegenerate?: () => void;
}

/**
 * ChartTypePicker - Inline grid of chart types for creating visualizations.
 *
 * Shows one card per chart type with:
 * - Live preview if a valid suggestion exists
 * - Placeholder icon if no suggestion
 * - Description of what the chart shows
 *
 * Clicking a card creates the visualization immediately.
 *
 * This component is used both standalone (inline in VisualizationsSection)
 * and within ChartTypePickerModal.
 *
 * Memoized to prevent re-renders when parent components update unrelated state.
 */
export const ChartTypePicker = memo(function ChartTypePicker({
  tableName,
  insight,
  columnAnalysis,
  rowCount,
  fieldMap,
  existingFields,
  onCreateChart,
  gridColumns = 3,
  isLoading = false,
  suggestionSeed = 0,
  onRegenerate,
}: ChartTypePickerProps) {
  // Generate suggestions for all chart types
  const suggestionsByType = useMemo(() => {
    if (columnAnalysis.length === 0 || rowCount === 0) {
      return new Map<VisualizationType, ChartSuggestion | null>();
    }

    return suggestForAllChartTypes(
      insight,
      columnAnalysis,
      rowCount,
      fieldMap,
      CHART_TYPES,
      { existingFields, seed: suggestionSeed },
    );
  }, [
    insight,
    columnAnalysis,
    rowCount,
    fieldMap,
    existingFields,
    suggestionSeed,
  ]);

  // Track whether column analysis has completed (empty array means still loading)
  const isAnalysisLoaded = columnAnalysis.length > 0;

  // Convert chart types to internal item format with disabled state
  const chartTypeItems: ChartTypeItem[] = useMemo(
    () =>
      CHART_TYPES.map((chartType) => {
        const suggestion = suggestionsByType.get(chartType) ?? null;
        // Only check unavailability after analysis is loaded
        // When analysis is loading, all cards remain clickable for manual configuration
        const unavailableReason = isAnalysisLoaded
          ? getChartTypeUnavailableReason(chartType, columnAnalysis)
          : null;

        return {
          chartType,
          suggestion,
          // Use string for reason, undefined when available
          disabled: unavailableReason ?? undefined,
        };
      }),
    [suggestionsByType, columnAnalysis, isAnalysisLoaded],
  );

  // Handle "Use suggestion" button click - create visualization with suggested encoding
  const handleUseSuggestion = useCallback(
    (chartType: VisualizationType) => {
      const suggestion = suggestionsByType.get(chartType);
      if (suggestion) {
        onCreateChart(suggestion);
      }
    },
    [suggestionsByType, onCreateChart],
  );

  // Handle "Create custom" button click - create visualization with empty encoding
  const handleCreateCustom = useCallback(
    (chartType: VisualizationType) => {
      const config = CHART_TYPE_CONFIG[chartType];
      const customSuggestion: ChartSuggestion = {
        id: `custom-${chartType}`,
        title: `New ${config.label.toLowerCase()} chart`,
        chartType,
        encoding: {},
      };
      onCreateChart(customSuggestion);
    },
    [onCreateChart],
  );

  // Check if there are any suggestions to show regenerate button
  const hasSuggestions = Array.from(suggestionsByType.values()).some(
    (s) => s !== null,
  );

  return (
    <div className="space-y-4">
      {/* Chart type grid */}
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
        }}
      >
        {chartTypeItems.map((item) => (
          <ChartTypeCard
            key={item.chartType}
            chartType={item.chartType}
            suggestion={item.suggestion}
            tableName={tableName}
            disabled={item.disabled}
            isLoading={isLoading}
            onUseSuggestion={() => handleUseSuggestion(item.chartType)}
            onCreateCustom={() => handleCreateCustom(item.chartType)}
          />
        ))}
      </div>
      {/* Regenerate button - only show if there are suggestions and callback provided */}
      {hasSuggestions && onRegenerate && !isLoading && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={onRegenerate}>
            <Sparkles className="mr-2 h-3 w-3" />
            Regenerate suggestions
          </Button>
        </div>
      )}
    </div>
  );
});
