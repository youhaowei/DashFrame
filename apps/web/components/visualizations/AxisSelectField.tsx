"use client";

import { useMemo } from "react";
import {
  SelectField,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Badge,
} from "@dashframe/ui";
import { AlertCircle, ArrowUpDown } from "@dashframe/ui/icons";
import type { ColumnAnalysis } from "@dashframe/engine-browser";
import type { VisualizationType, CompiledInsight } from "@dashframe/types";
import {
  getRankedColumnOptions,
  getColumnWarning,
  type AxisWarning,
} from "@/lib/visualizations/axis-warnings";
import {
  getValidColumnsForChannel,
  getAxisSemanticLabel,
  isColumnValidForChannel,
} from "@/lib/visualizations/encoding-enforcer";
import { getColumnIcon } from "@/lib/utils/field-icons";

interface AxisSelectFieldProps {
  /** Field label displayed above the select */
  label: string;
  /** Currently selected value */
  value: string;
  /** Callback when selection changes */
  onChange: (value: string) => void;
  /** Placeholder text when no selection */
  placeholder?: string;
  /** Additional CSS classes */
  className?: string;
  /** Callback for clear button */
  onClear?: () => void;
  /** Which axis this select controls */
  axis: "x" | "y";
  /** Current chart type - used for constraint logic */
  chartType: VisualizationType;
  /** Column analysis data - enables intelligent ranking and warnings */
  columnAnalysis: ColumnAnalysis[];
  /** Compiled insight with resolved dimensions and metrics */
  compiledInsight: CompiledInsight;
  /** The column selected for the other axis - used to detect same-column warnings */
  otherAxisColumn?: string;
  /** Callback to swap X and Y axis values - shown when selecting the other axis's column */
  onSwapAxes?: () => void;
}

/**
 * AxisSelectField - A select field specialized for axis configuration in visualizations.
 *
 * Computes available options from the compiled insight:
 * - Dimensions: from compiledInsight.dimensions (resolved Field objects)
 * - Metrics: from compiledInsight.metrics (using metric.name as value)
 *
 * Provides:
 * - Hard enforcement of valid columns for each chart type
 * - Semantic labels showing what type of data belongs on each axis
 * - Intelligent column ranking by suitability for the axis
 * - Warning indicators for soft issues (high cardinality, etc.)
 */
export function AxisSelectField({
  label,
  value,
  onChange,
  placeholder = "Select column...",
  className,
  onClear,
  axis,
  chartType,
  columnAnalysis,
  compiledInsight,
  otherAxisColumn,
  onSwapAxes,
}: AxisSelectFieldProps) {
  // Compute all available column options from compiled insight
  const allOptions = useMemo(() => {
    const options: Array<{ label: string; value: string }> = [];

    // Add dimensions (resolved Field objects)
    compiledInsight.dimensions.forEach((field) => {
      options.push({ label: field.name, value: field.name });
    });

    // Add metrics using their display names
    // metric.name matches the SQL alias (AS "${metric.name}") and columnAnalysis
    compiledInsight.metrics.forEach((metric) => {
      options.push({ label: metric.name, value: metric.name });
    });

    return options;
  }, [compiledInsight]);

  // Build semantic label with hint (e.g., "X Axis (Category)")
  const semanticLabel = useMemo(() => {
    const hint = getAxisSemanticLabel(axis, chartType);
    return hint ? `${label} (${hint})` : label;
  }, [label, axis, chartType]);

  // Build set of metric names for icon lookup
  const metricNames = useMemo(() => {
    return new Set(compiledInsight.metrics.map((m) => m.name));
  }, [compiledInsight.metrics]);

  // Get ranked options with warnings when analysis data is available
  // Also filters to only valid columns for this channel/chart type
  const rankedOptions = useMemo(() => {
    if (columnAnalysis.length === 0) {
      // No analysis available, return options as-is with icons
      return allOptions.map((opt) => ({
        label: opt.label,
        value: opt.value,
        description: undefined,
        icon: getColumnIcon(opt.value, columnAnalysis, metricNames),
      }));
    }

    // Get valid columns for this channel (hard enforcement)
    // Pass compiledInsight so enforcer knows which columns are metrics vs dimensions
    const validColumnNames = getValidColumnsForChannel(
      axis,
      chartType,
      columnAnalysis,
      compiledInsight,
    );
    const validColumnSet = new Set(validColumnNames);

    // Filter options to only valid columns
    // Note: We allow selecting the same column as the other axis - this can help fix broken configs
    // The warning system will alert users if they select the same column on both axes
    const validOptions = allOptions.filter((opt) =>
      validColumnSet.has(opt.value),
    );
    const columnNames = validOptions.map((opt) => opt.value);

    // Rank the valid options
    const ranked = getRankedColumnOptions(
      columnNames,
      axis,
      chartType,
      columnAnalysis,
      otherAxisColumn,
    );

    // Transform to SelectField format with icons and warnings
    const result = ranked.map((opt) => {
      // Special case: if this option is the other axis's column, show swap hint
      const isOtherAxisColumn = opt.value === otherAxisColumn;
      let description: string | undefined;
      if (isOtherAxisColumn && onSwapAxes) {
        description = "↔️ Swap axes";
      } else if (opt.warning) {
        description = `⚠️ ${opt.warning.message}`;
      }

      return {
        label: opt.label,
        value: opt.value,
        description,
        icon: getColumnIcon(opt.value, columnAnalysis, metricNames),
      };
    });

    // If the current value is invalid but still selected, include it in the options
    // so the user can see what's selected and understand the error message.
    // This prevents the select from appearing blank when an invalid option is selected.
    if (value && !validColumnSet.has(value)) {
      const currentOption = allOptions.find((opt) => opt.value === value);
      if (currentOption) {
        result.unshift({
          label: currentOption.label,
          value: currentOption.value,
          description: "⛔ Invalid for this chart type",
          icon: getColumnIcon(currentOption.value, columnAnalysis, metricNames),
        });
      }
    }

    return result;
  }, [
    allOptions,
    axis,
    chartType,
    columnAnalysis,
    compiledInsight,
    metricNames,
    otherAxisColumn,
    value,
  ]);

  // Check if current selection is valid for this axis/chart type (hard error)
  const validationError = useMemo(() => {
    if (!value || columnAnalysis.length === 0) return null;
    const result = isColumnValidForChannel(
      value,
      axis,
      chartType,
      columnAnalysis,
      compiledInsight,
    );
    return result.suitable ? null : result.reason;
  }, [value, axis, chartType, columnAnalysis, compiledInsight]);

  // Check if current value is same as other axis (for swap action)
  const isSameAsOtherAxis =
    value && otherAxisColumn && value === otherAxisColumn;

  // Get warning for current selection (soft warning)
  const currentWarning: AxisWarning | null = useMemo(() => {
    // Don't show warning if there's already a validation error
    if (validationError) return null;
    if (!columnAnalysis || !value) return null;
    // Don't show "same column" warning if we'll show swap action instead
    if (isSameAsOtherAxis && onSwapAxes) return null;
    // Build otherColumns object: if we're configuring X, otherAxisColumn goes on Y, and vice versa
    let otherColumns: { x?: string; y?: string } | undefined;
    if (otherAxisColumn) {
      otherColumns =
        axis === "x" ? { y: otherAxisColumn } : { x: otherAxisColumn };
    }
    return getColumnWarning(
      value,
      axis,
      chartType,
      columnAnalysis,
      otherColumns,
    );
  }, [
    value,
    axis,
    chartType,
    columnAnalysis,
    otherAxisColumn,
    validationError,
    isSameAsOtherAxis,
    onSwapAxes,
  ]);

  // Build label addon - either swap action or warning badge
  const labelAddon = useMemo(() => {
    // Show swap action if same column is on both axes
    if (isSameAsOtherAxis && onSwapAxes) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="cursor-pointer border-blue-200 bg-blue-50 px-1.5 py-0.5 text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSwapAxes();
              }}
            >
              <ArrowUpDown className="mr-1 h-3 w-3" />
              <span className="text-[10px]">Swap</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-sm">Swap X and Y axis values</p>
          </TooltipContent>
        </Tooltip>
      );
    }

    // Show warning badge if there's a warning
    if (currentWarning) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
            >
              <AlertCircle className="mr-1 h-3 w-3" />
              <span className="text-[10px]">{currentWarning.message}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-sm">{currentWarning.reason}</p>
          </TooltipContent>
        </Tooltip>
      );
    }

    return undefined;
  }, [isSameAsOtherAxis, onSwapAxes, currentWarning]);

  // Handle selection - if selecting the other axis's column, trigger swap instead
  const handleChange = (newValue: string) => {
    if (newValue === otherAxisColumn && onSwapAxes) {
      onSwapAxes();
    } else {
      onChange(newValue);
    }
  };

  return (
    <SelectField
      label={semanticLabel}
      labelAddon={labelAddon}
      value={value}
      onChange={handleChange}
      options={rankedOptions}
      placeholder={placeholder}
      className={className}
      onClear={onClear}
      error={validationError ?? undefined}
    />
  );
}
