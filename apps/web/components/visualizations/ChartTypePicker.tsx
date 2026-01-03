"use client";

import { useMemo, useCallback, memo, useState } from "react";
import {
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Toggle,
  CHART_ICONS,
} from "@dashframe/ui";
import { Button } from "@dashframe/ui/primitives/button";
import { SparklesIcon, InfoIcon } from "@dashframe/ui/icons";
import {
  CHART_TYPE_METADATA,
  getChartTypesForTag,
  type VisualizationType,
  type ChartTag,
  type Field,
} from "@dashframe/types";
import type { ColumnAnalysis } from "@dashframe/engine-browser";
import type { Insight } from "@/lib/stores/types";
import {
  suggestByTag,
  suggestByChartType,
  type ChartSuggestion,
  type TagSuggestion,
} from "@/lib/visualizations/suggest-charts";
import { SCATTER_MAX_POINTS } from "@dashframe/types";
import { Chart } from "@dashframe/visualization";

/** Height of the chart preview area in pixels */
const PREVIEW_HEIGHT = 120;

/** All chart types for the compact grid */
const ALL_CHART_TYPES: VisualizationType[] = [
  "barY",
  "barX",
  "line",
  "areaY",
  "dot",
  "hexbin",
  "heatmap",
  "raster",
];

/** Format encoding spec for display */
function formatEncodingSpec(suggestion: ChartSuggestion): string {
  const parts: string[] = [];
  const enc = suggestion.encoding;
  if (enc.xLabel) parts.push(`X: ${enc.xLabel}`);
  if (enc.yLabel) parts.push(`Y: ${enc.yLabel}`);
  if (enc.colorLabel) parts.push(`Color: ${enc.colorLabel}`);
  return parts.join(" · ");
}

// =============================================================================
// Category Card Component (for tag-based suggestions)
// =============================================================================

interface CategoryCardProps {
  tagSuggestion: TagSuggestion;
  tableName: string;
  /** Total row count - used to disable scatter for large datasets */
  rowCount: number;
  isLoading?: boolean;
  /** Called when user clicks to create with current chart type */
  onSelect: (chartType: VisualizationType, suggestion: ChartSuggestion) => void;
  /** Get suggestion for a specific chart type within a tag context (for variant switching) */
  getSuggestionForType: (
    chartType: VisualizationType,
    tag: ChartTag,
  ) => ChartSuggestion | null;
}

/**
 * Category card showing a suggested chart for an analytical purpose (tag).
 * Displays category title with info tooltip, chart preview, title and encoding.
 * Includes variant toggle for switching between chart types in the same category.
 */
const CategoryCard = memo(function CategoryCard({
  tagSuggestion,
  tableName,
  rowCount,
  isLoading = false,
  onSelect,
  getSuggestionForType,
}: CategoryCardProps) {
  const {
    tag,
    tagDisplayName,
    tagDescription,
    chartType: defaultChartType,
    suggestion: defaultSuggestion,
  } = tagSuggestion;

  // Get all chart types for this tag
  const variantTypes = useMemo(() => getChartTypesForTag(tag), [tag]);

  // Determine which chart types should be disabled (e.g., scatter for large datasets)
  const disabledTypes = useMemo(() => {
    const disabled = new Set<VisualizationType>();
    // Disable scatter (dot) for datasets exceeding threshold
    if (tag === "correlation" && rowCount > SCATTER_MAX_POINTS) {
      disabled.add("dot");
    }
    return disabled;
  }, [tag, rowCount]);

  // State for selected variant (defaults to suggested chart type)
  const [selectedType, setSelectedType] =
    useState<VisualizationType>(defaultChartType);

  // Get the current suggestion (either default or for selected variant)
  // Pass the tag context so suggestions adapt to the analytical purpose
  const currentSuggestion = useMemo(() => {
    if (selectedType === defaultChartType) {
      return defaultSuggestion;
    }
    return getSuggestionForType(selectedType, tag) ?? defaultSuggestion;
  }, [
    selectedType,
    defaultChartType,
    defaultSuggestion,
    getSuggestionForType,
    tag,
  ]);

  // Current chart type to display
  const currentChartType =
    currentSuggestion === defaultSuggestion ? defaultChartType : selectedType;
  const currentMeta = CHART_TYPE_METADATA[currentChartType];
  const ChartIcon = CHART_ICONS[currentChartType];

  // Only show toggle if there are multiple variants
  const showVariantToggle = variantTypes.length > 1;

  // Handle click on the card (excluding the toggle area)
  const handleCardClick = useCallback(() => {
    if (!isLoading) {
      onSelect(currentChartType, currentSuggestion);
    }
  }, [isLoading, onSelect, currentChartType, currentSuggestion]);

  return (
    <div
      role="button"
      tabIndex={isLoading ? -1 : 0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick();
        }
      }}
      className={cn(
        "group flex w-full cursor-pointer flex-col overflow-hidden rounded-xl border",
        "bg-card text-left transition-all duration-150",
        "hover:border-primary/40 hover:shadow-sm",
        "focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
        isLoading && "cursor-not-allowed opacity-50",
      )}
    >
      {/* Header: Category title + info icon with tooltip */}
      <div className="flex items-center gap-1.5 px-3 pt-3">
        <span className="text-sm font-medium text-foreground">
          {tagDisplayName}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="cursor-help text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <InfoIcon className="h-3.5 w-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[200px]">
            <p className="text-xs">{tagDescription}</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Variant toggle - using existing Toggle component */}
      {showVariantToggle && (
        <div
          className="flex justify-center px-3 pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          <Toggle
            variant="outline"
            size="sm"
            value={currentChartType}
            onValueChange={(type) => setSelectedType(type as VisualizationType)}
            options={variantTypes.map((type) => {
              const TypeIcon = CHART_ICONS[type];
              const typeMeta = CHART_TYPE_METADATA[type];
              const isDisabled = disabledTypes.has(type);
              return {
                value: type,
                icon: <TypeIcon size={12} />,
                label: typeMeta.displayName,
                disabled: isDisabled,
                tooltip: isDisabled
                  ? `${typeMeta.displayName} not recommended for ${rowCount.toLocaleString()}+ rows`
                  : undefined,
              };
            })}
          />
        </div>
      )}

      {/* Preview Section */}
      <div
        className="mx-3 mt-2 overflow-hidden rounded-lg bg-muted/30"
        style={{ height: `${PREVIEW_HEIGHT}px` }}
      >
        {isLoading ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="h-full w-full animate-pulse rounded-lg bg-muted" />
          </div>
        ) : (
          <Chart
            tableName={tableName}
            visualizationType={currentChartType}
            encoding={currentSuggestion.encoding}
            height={PREVIEW_HEIGHT}
            preview
            className="h-full w-full"
          />
        )}
      </div>

      {/* Content: Chart title and encoding */}
      <div className="flex flex-1 flex-col px-3 pt-2 pb-3">
        {/* Chart type with icon */}
        <div className="flex items-center gap-1.5">
          <ChartIcon size={14} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {currentMeta.displayName}
          </span>
        </div>

        {/* Suggestion title */}
        <p className="mt-1 text-sm leading-tight font-medium text-foreground">
          {currentSuggestion.title}
        </p>

        {/* Encoding spec */}
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {formatEncodingSpec(currentSuggestion)}
        </p>
      </div>
    </div>
  );
});

// =============================================================================
// Compact Chart Type Grid
// =============================================================================

interface ChartTypeGridProps {
  insight: Insight;
  columnAnalysis: ColumnAnalysis[];
  rowCount: number;
  fieldMap: Record<string, Field>;
  existingFields: string[];
  onCreateChart: (suggestion: ChartSuggestion) => void;
  isLoading?: boolean;
  suggestionSeed?: number;
}

/**
 * Compact grid of all chart types as clickable icons.
 * Clicking creates a chart with auto-suggested encoding (or empty if no suggestion).
 */
const ChartTypeGrid = memo(function ChartTypeGrid({
  insight,
  columnAnalysis,
  rowCount,
  fieldMap,
  existingFields,
  onCreateChart,
  isLoading = false,
  suggestionSeed = 0,
}: ChartTypeGridProps) {
  // Generate suggestions for all chart types
  const suggestionsByType = useMemo(() => {
    const map = new Map<VisualizationType, ChartSuggestion | null>();
    if (columnAnalysis.length === 0 || rowCount === 0) {
      return map;
    }

    for (const chartType of ALL_CHART_TYPES) {
      const suggestion = suggestByChartType(
        insight,
        columnAnalysis,
        rowCount,
        fieldMap,
        chartType,
        { existingFields, seed: suggestionSeed },
      );
      map.set(chartType, suggestion);
    }
    return map;
  }, [
    insight,
    columnAnalysis,
    rowCount,
    fieldMap,
    existingFields,
    suggestionSeed,
  ]);

  const handleClick = useCallback(
    (chartType: VisualizationType) => {
      const suggestion = suggestionsByType.get(chartType);
      if (suggestion) {
        onCreateChart(suggestion);
      } else {
        // Create with empty encoding for manual configuration
        const meta = CHART_TYPE_METADATA[chartType];
        const customSuggestion: ChartSuggestion = {
          id: `custom-${chartType}`,
          title: `New ${meta.displayName.toLowerCase()} chart`,
          chartType,
          encoding: {},
        };
        onCreateChart(customSuggestion);
      }
    },
    [suggestionsByType, onCreateChart],
  );

  return (
    <div className="grid grid-cols-8 gap-1">
      {ALL_CHART_TYPES.map((chartType) => {
        const meta = CHART_TYPE_METADATA[chartType];
        const ChartIcon = CHART_ICONS[chartType];
        const hasSuggestion = suggestionsByType.get(chartType) !== null;

        return (
          <Tooltip key={chartType}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => handleClick(chartType)}
                disabled={isLoading}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 rounded-lg p-2",
                  "transition-colors duration-100",
                  "hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
                  isLoading && "cursor-not-allowed opacity-50",
                  hasSuggestion && "text-foreground",
                  !hasSuggestion && "text-muted-foreground",
                )}
              >
                <ChartIcon size={20} />
                <span className="text-[10px] leading-tight">
                  {meta.displayName}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[200px]">
              <p className="font-medium">{meta.displayName}</p>
              <p className="text-xs text-muted-foreground">{meta.hint}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
});

// =============================================================================
// Main ChartTypePicker Component
// =============================================================================

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
  /** Number of grid columns for category cards (default: 4) */
  gridColumns?: number;
  /** Show loading state for all chart previews */
  isLoading?: boolean;
  /** Seed for shuffling chart suggestions */
  suggestionSeed?: number;
  /** Callback to regenerate suggestions with a new seed */
  onRegenerate?: () => void;
}

/**
 * ChartTypePicker - Two-tier chart selection interface.
 *
 * Top section: Category cards showing one suggested chart per analytical purpose
 * (comparison, trend, correlation, distribution). Each card shows a live preview
 * with the best chart type and encoding for that category.
 *
 * Bottom section: Compact grid of all 8 chart types as icons for direct selection.
 * Power users can pick any chart type directly, getting auto-suggested encoding
 * or empty encoding for manual configuration.
 *
 * Features:
 * - Tag-based suggestions prioritize analytical intent over chart type
 * - Live previews with actual data
 * - Regenerate button for alternative suggestions
 * - "Create custom" section for direct chart type selection
 */
export const ChartTypePicker = memo(function ChartTypePicker({
  tableName,
  insight,
  columnAnalysis,
  rowCount,
  fieldMap,
  existingFields,
  onCreateChart,
  gridColumns = 4,
  isLoading = false,
  suggestionSeed = 0,
  onRegenerate,
}: ChartTypePickerProps) {
  // Generate tag-based suggestions
  const tagSuggestions = useMemo(() => {
    if (columnAnalysis.length === 0 || rowCount === 0) {
      return [];
    }

    return suggestByTag(insight, columnAnalysis, rowCount, fieldMap, {
      seed: suggestionSeed,
    });
  }, [insight, columnAnalysis, rowCount, fieldMap, suggestionSeed]);

  // Get suggestion for a specific chart type within a tag context (for variant switching in CategoryCard)
  // The tag context affects encoding selection (e.g., "trend" uses temporal X even for barY)
  const getSuggestionForType = useCallback(
    (
      chartType: VisualizationType,
      tagContext: ChartTag,
    ): ChartSuggestion | null => {
      if (columnAnalysis.length === 0 || rowCount === 0) {
        return null;
      }
      return suggestByChartType(
        insight,
        columnAnalysis,
        rowCount,
        fieldMap,
        chartType,
        { existingFields, seed: suggestionSeed, tagContext },
      );
    },
    [
      insight,
      columnAnalysis,
      rowCount,
      fieldMap,
      existingFields,
      suggestionSeed,
    ],
  );

  // Handle category card selection (receives chart type and suggestion from card)
  const handleCategorySelect = useCallback(
    (_chartType: VisualizationType, suggestion: ChartSuggestion) => {
      onCreateChart(suggestion);
    },
    [onCreateChart],
  );

  // Check if there are any suggestions to show regenerate button
  const hasSuggestions = tagSuggestions.length > 0;

  // Render category cards section based on state
  const renderCategoryCards = () => {
    if (hasSuggestions) {
      return (
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(${Math.min(gridColumns, tagSuggestions.length)}, minmax(0, 1fr))`,
          }}
        >
          {tagSuggestions.map((tagSuggestion) => (
            <CategoryCard
              key={tagSuggestion.tag}
              tagSuggestion={tagSuggestion}
              tableName={tableName}
              rowCount={rowCount}
              isLoading={isLoading}
              onSelect={handleCategorySelect}
              getSuggestionForType={getSuggestionForType}
            />
          ))}
        </div>
      );
    }

    if (isLoading) {
      // Show loading state while column analysis is pending
      return (
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
          <p className="text-sm">Loading suggestions...</p>
        </div>
      );
    }

    // No suggestions available
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
        <p className="text-sm">No chart suggestions available</p>
        <p className="mt-1 text-xs">
          Add fields to your insight to see suggestions
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Category cards section */}
      {renderCategoryCards()}

      {/* Regenerate button */}
      {hasSuggestions && onRegenerate && !isLoading && (
        <div className="flex justify-center">
          <Button variant="text" size="sm" onClick={onRegenerate}>
            <SparklesIcon className="mr-2 h-3 w-3" />
            Regenerate suggestions
          </Button>
        </div>
      )}

      {/* Create custom section - always visible */}
      <div className="border-t pt-3">
        <p className="mb-3 text-sm text-muted-foreground">Create custom</p>
        <ChartTypeGrid
          insight={insight}
          columnAnalysis={columnAnalysis}
          rowCount={rowCount}
          fieldMap={fieldMap}
          existingFields={existingFields}
          onCreateChart={onCreateChart}
          isLoading={isLoading}
          suggestionSeed={suggestionSeed}
        />
      </div>
    </div>
  );
});

// =============================================================================
// Exported Utilities (for backwards compatibility)
// =============================================================================

/**
 * Configuration for each chart type including display info and usage hints.
 * @deprecated Use CHART_TYPE_METADATA from @dashframe/types instead.
 */
export const CHART_TYPE_CONFIG = CHART_TYPE_METADATA;

/**
 * Ordered list of chart types for display.
 * @deprecated Use ALL_CHART_TYPES or CHART_TYPE_METADATA keys.
 */
export const CHART_TYPES = ALL_CHART_TYPES;
