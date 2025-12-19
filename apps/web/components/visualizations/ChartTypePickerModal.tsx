"use client";

import { useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  ItemList,
  cn,
  type ListItem,
} from "@dashframe/ui";
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
  type ChartSuggestion,
} from "@/lib/visualizations/suggest-charts";
import { Chart } from "@dashframe/visualization";

/**
 * Configuration for each chart type including display info and icon.
 */
const CHART_TYPE_CONFIG: Record<
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
const CHART_TYPES: VisualizationType[] = [
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
 */
interface ChartTypeListItem extends ListItem {
  chartType: VisualizationType;
  suggestion: ChartSuggestion | null;
}

interface ChartTypeCardProps {
  chartType: VisualizationType;
  suggestion: ChartSuggestion | null;
  tableName: string;
  onClick: () => void;
}

/**
 * Chart type card with preview - similar to VisualizationItemCard.
 * Shows a chart preview or placeholder icon with consistent sizing.
 */
function ChartTypeCard({
  chartType,
  suggestion,
  tableName,
  onClick,
}: ChartTypeCardProps) {
  const config = CHART_TYPE_CONFIG[chartType];
  const Icon = config.icon;
  const hasSuggestion = suggestion !== null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group w-full cursor-pointer overflow-hidden rounded-lg border text-left transition-all",
        "border-border/60 hover:border-border hover:bg-accent/50",
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
              Configure manually
            </span>
          </div>
        )}
      </div>

      {/* Content Section - no truncation on title */}
      <div className="p-4">
        <p className="text-foreground text-sm font-medium">{config.label}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {hasSuggestion ? suggestion.title : config.description}
        </p>
      </div>
    </div>
  );
}

interface ChartTypePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
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
}

/**
 * Modal for selecting a chart type when creating a visualization.
 *
 * Shows one card per chart type with:
 * - Live preview if a valid suggestion exists
 * - Placeholder icon if no suggestion
 * - Description of what the chart shows
 *
 * Clicking a card creates the visualization immediately.
 */
export function ChartTypePickerModal({
  isOpen,
  onClose,
  tableName,
  insight,
  columnAnalysis,
  rowCount,
  fieldMap,
  existingFields,
  onCreateChart,
}: ChartTypePickerModalProps) {
  // Generate suggestions for all chart types
  const suggestionsByType = useMemo(() => {
    if (!isOpen || columnAnalysis.length === 0 || rowCount === 0) {
      console.debug("[ChartTypePickerModal] Skipping suggestions:", {
        isOpen,
        columnAnalysisLength: columnAnalysis.length,
        rowCount,
      });
      return new Map<VisualizationType, ChartSuggestion | null>();
    }

    console.debug("[ChartTypePickerModal] Generating suggestions:", {
      columnAnalysisLength: columnAnalysis.length,
      rowCount,
      fieldMapKeys: Object.keys(fieldMap),
      existingFields,
    });

    const result = suggestForAllChartTypes(
      insight,
      columnAnalysis,
      rowCount,
      fieldMap,
      CHART_TYPES,
      { existingFields },
    );

    console.debug("[ChartTypePickerModal] Suggestions result:", {
      bar: result.get("bar"),
      line: result.get("line"),
      scatter: result.get("scatter"),
    });

    return result;
  }, [isOpen, insight, columnAnalysis, rowCount, fieldMap, existingFields]);

  // Convert chart types to ListItem format
  const chartTypeItems: ChartTypeListItem[] = useMemo(
    () =>
      CHART_TYPES.map((chartType) => {
        const config = CHART_TYPE_CONFIG[chartType];
        const suggestion = suggestionsByType.get(chartType) ?? null;

        return {
          id: chartType,
          title: config.label,
          subtitle: suggestion ? suggestion.title : config.description,
          icon: config.icon,
          chartType,
          suggestion,
        };
      }),
    [suggestionsByType],
  );

  // Handle item selection - create visualization
  const handleSelect = useCallback(
    (chartTypeId: string) => {
      const chartType = chartTypeId as VisualizationType;
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

      onClose();
    },
    [suggestionsByType, onCreateChart, onClose],
  );

  // Custom render function for chart type cards
  const renderChartTypeCard = useCallback(
    (item: ChartTypeListItem, onClick: () => void) => (
      <ChartTypeCard
        chartType={item.chartType}
        suggestion={item.suggestion}
        tableName={tableName}
        onClick={onClick}
      />
    ),
    [tableName],
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Create visualization</DialogTitle>
          <DialogDescription>
            Choose a chart type to visualize your data
          </DialogDescription>
        </DialogHeader>

        {/* Grid with 3 columns, vertical scroll if needed */}
        <div className="max-h-[60vh] overflow-y-auto pt-4">
          <ItemList
            items={chartTypeItems}
            onSelect={handleSelect}
            orientation="grid"
            gridColumns={3}
            gap={16}
            renderItem={renderChartTypeCard}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
