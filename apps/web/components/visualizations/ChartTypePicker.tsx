"use client";

import { useMemo, useCallback } from "react";
import { ItemList, cn, type ListItem } from "@dashframe/ui";
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
 * Configuration for each chart type including display info and icon.
 */
export const CHART_TYPE_CONFIG: Record<
  VisualizationType,
  { label: string; icon: LucideIcon; description: string }
> = {
  bar: {
    label: "Bar",
    icon: BarChart,
    description: "Compare categories",
  },
  barHorizontal: {
    label: "Horizontal bar",
    icon: BarChartHorizontal,
    description: "Compare categories horizontally",
  },
  line: {
    label: "Line",
    icon: LineChart,
    description: "Show trends over time",
  },
  area: {
    label: "Area",
    icon: AreaChart,
    description: "Show cumulative trends",
  },
  scatter: {
    label: "Scatter",
    icon: ScatterChart,
    description: "Show correlations",
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
  "barHorizontal",
];

/** Height of the chart preview area in pixels */
const PREVIEW_HEIGHT = 140;

/**
 * Extended ListItem for chart type cards.
 * Uses `disabled` from ListItem (string | boolean) to indicate unavailability.
 */
interface ChartTypeListItem extends ListItem {
  chartType: VisualizationType;
  suggestion: ChartSuggestion | null;
}

interface ChartTypeCardProps {
  chartType: VisualizationType;
  suggestion: ChartSuggestion | null;
  tableName: string;
  /** When string, shows as reason; when true, just disables */
  disabled?: boolean | string;
  onClick: () => void;
}

/**
 * Chart type card with preview - similar to VisualizationItemCard.
 * Shows a chart preview or placeholder icon with consistent sizing.
 * When disabled, shows grayed out state with explanation.
 */
function ChartTypeCard({
  chartType,
  suggestion,
  tableName,
  disabled,
  onClick,
}: ChartTypeCardProps) {
  const config = CHART_TYPE_CONFIG[chartType];
  const Icon = config.icon;
  const hasSuggestion = suggestion !== null;
  const isDisabled = Boolean(disabled);
  const disabledReason = typeof disabled === "string" ? disabled : null;

  return (
    <div
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      onClick={isDisabled ? undefined : onClick}
      onKeyDown={
        isDisabled
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
      }
      aria-disabled={isDisabled}
      className={cn(
        "group w-full overflow-hidden rounded-lg border text-left transition-all",
        isDisabled
          ? "border-border/40 cursor-not-allowed opacity-50"
          : "border-border/60 hover:border-border hover:bg-accent/50 cursor-pointer",
      )}
    >
      {/* Preview Section - fixed height */}
      <div
        className="bg-muted/30 w-full overflow-hidden"
        style={{ height: `${PREVIEW_HEIGHT}px` }}
      >
        {hasSuggestion ? (
          <Chart
            tableName={tableName}
            visualizationType={chartType}
            encoding={suggestion.encoding}
            height={PREVIEW_HEIGHT}
            preview
            className="h-full w-full"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
            <Icon className="text-muted-foreground/40 h-10 w-10" />
            <span className="text-muted-foreground/60 text-sm">
              {disabledReason ?? "Configure manually"}
            </span>
          </div>
        )}
      </div>

      {/* Content Section - no truncation on title */}
      <div className="p-4">
        <p
          className={cn(
            "text-sm font-medium",
            isDisabled ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {config.label}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          {hasSuggestion ? suggestion.title : config.description}
        </p>
      </div>
    </div>
  );
}

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
 */
export function ChartTypePicker({
  tableName,
  insight,
  columnAnalysis,
  rowCount,
  fieldMap,
  existingFields,
  onCreateChart,
  gridColumns = 3,
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
      { existingFields },
    );
  }, [insight, columnAnalysis, rowCount, fieldMap, existingFields]);

  // Convert chart types to ListItem format with disabled state
  const chartTypeItems: ChartTypeListItem[] = useMemo(
    () =>
      CHART_TYPES.map((chartType) => {
        const config = CHART_TYPE_CONFIG[chartType];
        const suggestion = suggestionsByType.get(chartType) ?? null;
        // Get unavailable reason (string) or null if available
        const unavailableReason = getChartTypeUnavailableReason(
          chartType,
          columnAnalysis,
        );

        return {
          id: chartType,
          title: config.label,
          subtitle: suggestion ? suggestion.title : config.description,
          icon: config.icon,
          chartType,
          suggestion,
          // Use string for reason, undefined when available
          disabled: unavailableReason ?? undefined,
        };
      }),
    [suggestionsByType, columnAnalysis],
  );

  // Handle item selection - create visualization
  const handleSelect = useCallback(
    (chartTypeId: string) => {
      const chartType = chartTypeId as VisualizationType;
      const item = chartTypeItems.find((i) => i.chartType === chartType);

      // Don't allow selection of disabled chart types
      if (item?.disabled) {
        return;
      }

      const suggestion = suggestionsByType.get(chartType);

      if (suggestion) {
        // Use the data-driven suggestion
        onCreateChart(suggestion);
      } else {
        // Create a generic fallback suggestion
        const config = CHART_TYPE_CONFIG[chartType];
        const genericSuggestion: ChartSuggestion = {
          id: `generic-${chartType}`,
          title: `New ${config.label.toLowerCase()} chart`,
          chartType,
          encoding: {},
        };
        onCreateChart(genericSuggestion);
      }
    },
    [suggestionsByType, onCreateChart, chartTypeItems],
  );

  // Custom render function for chart type cards
  const renderChartTypeCard = useCallback(
    (item: ChartTypeListItem, onClick: () => void) => (
      <ChartTypeCard
        chartType={item.chartType}
        suggestion={item.suggestion}
        tableName={tableName}
        disabled={item.disabled}
        onClick={onClick}
      />
    ),
    [tableName],
  );

  return (
    <ItemList
      items={chartTypeItems}
      onSelect={handleSelect}
      orientation="grid"
      gridColumns={gridColumns}
      gap={16}
      renderItem={renderChartTypeCard}
    />
  );
}
