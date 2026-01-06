"use client";

import { getColumnIcon } from "@/lib/utils/field-icons";
import {
  getColumnWarning,
  getRankedColumnOptions,
  type AxisWarning,
} from "@/lib/visualizations/axis-warnings";
import {
  getAxisSemanticLabel,
  getValidColumnsForChannel,
  isColumnValidForChannel,
} from "@/lib/visualizations/encoding-enforcer";
import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import type { ColumnAnalysis } from "@dashframe/engine-browser";
import type {
  CompiledInsight,
  UUID,
  VisualizationType,
} from "@dashframe/types";
import { fieldEncoding, metricEncoding } from "@dashframe/types";
import {
  Badge,
  SelectField,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@dashframe/ui";
import { AlertCircleIcon, ArrowUpDownIcon } from "@dashframe/ui/icons";
import { useCallback, useMemo } from "react";

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
  // Values use encoding format (field:<uuid>, metric:<uuid>) for storage
  const allOptions = useMemo(() => {
    const options: Array<{ label: string; value: string }> = [];

    // Add dimensions (resolved Field objects)
    // Use field:<uuid> encoding format for value
    compiledInsight.dimensions.forEach((field) => {
      options.push({
        label: field.name,
        value: fieldEncoding(field.id as UUID),
      });
    });

    // Add metrics using metric:<uuid> encoding format
    compiledInsight.metrics.forEach((metric) => {
      options.push({
        label: metric.name,
        value: metricEncoding(metric.id as UUID),
      });
    });

    return options;
  }, [compiledInsight]);

  // Build mapping from storage encoding (field:<uuid>) to SQL alias (field_<uuid>)
  // This allows us to work with columnAnalysis which uses SQL alias format
  const encodingToSqlAlias = useMemo(() => {
    const map = new Map<string, string>();
    compiledInsight.dimensions.forEach((field) => {
      const enc = fieldEncoding(field.id as UUID);
      const alias = fieldIdToColumnAlias(field.id);
      map.set(enc, alias);
    });
    compiledInsight.metrics.forEach((metric) => {
      const enc = metricEncoding(metric.id as UUID);
      const alias = metricIdToColumnAlias(metric.id);
      map.set(enc, alias);
    });
    return map;
  }, [compiledInsight]);

  // Reverse mapping: SQL alias to storage encoding
  const sqlAliasToEncoding = useMemo(() => {
    const map = new Map<string, string>();
    for (const [enc, alias] of encodingToSqlAlias.entries()) {
      map.set(alias, enc);
    }
    return map;
  }, [encodingToSqlAlias]);

  // Helper to convert storage encoding to SQL alias
  // Wrapped in useCallback to maintain stable reference for useMemo dependencies
  const toSqlAlias = useCallback(
    (encodingValue: string | undefined): string | undefined => {
      if (!encodingValue) return undefined;
      return encodingToSqlAlias.get(encodingValue);
    },
    [encodingToSqlAlias],
  );

  // Build semantic label with hint (e.g., "X Axis (Category)")
  const semanticLabel = useMemo(() => {
    const hint = getAxisSemanticLabel(axis, chartType);
    return hint ? `${label} (${hint})` : label;
  }, [label, axis, chartType]);

  // Build set of metric SQL aliases for icon lookup
  // Metrics appear in columnAnalysis as metric_<uuid> aliases
  const metricAliases = useMemo(() => {
    return new Set(
      compiledInsight.metrics.map((m) => metricIdToColumnAlias(m.id)),
    );
  }, [compiledInsight.metrics]);

  // Convert otherAxisColumn from storage encoding to SQL alias for comparison
  const otherAxisAlias = useMemo(
    () => toSqlAlias(otherAxisColumn),
    [otherAxisColumn, toSqlAlias],
  );

  // Get ranked options with warnings when analysis data is available
  // Also filters to only valid columns for this channel/chart type
  const rankedOptions = useMemo(() => {
    if (columnAnalysis.length === 0) {
      // No analysis available, return options as-is with icons
      return allOptions.map((opt) => {
        const sqlAlias = toSqlAlias(opt.value);
        return {
          label: opt.label,
          value: opt.value,
          description: undefined,
          icon: getColumnIcon(
            sqlAlias ?? opt.value,
            columnAnalysis,
            metricAliases,
          ),
        };
      });
    }

    // Get valid columns for this channel (hard enforcement)
    // Pass compiledInsight so enforcer knows which columns are metrics vs dimensions
    // Returns SQL alias format (field_<uuid> or metric_<uuid>)
    const validColumnAliases = getValidColumnsForChannel(
      axis,
      chartType,
      columnAnalysis,
      compiledInsight,
    );
    const validAliasSet = new Set(validColumnAliases);

    // Filter options by checking if their SQL alias is valid
    const validOptions = allOptions.filter((opt) => {
      const alias = toSqlAlias(opt.value);
      return alias && validAliasSet.has(alias);
    });

    // Get SQL aliases for ranking
    const validAliases = validOptions
      .map((opt) => toSqlAlias(opt.value))
      .filter((a): a is string => !!a);

    // Rank the valid options using SQL aliases
    const ranked = getRankedColumnOptions(
      validAliases,
      axis,
      chartType,
      columnAnalysis,
      otherAxisAlias,
    );

    // Transform to SelectField format with icons and warnings
    // Map SQL alias back to storage encoding for the value
    const result = ranked.map((opt) => {
      // Look up the original option with storage encoding
      const storageEncoding = sqlAliasToEncoding.get(opt.value);
      const originalOpt = allOptions.find((o) => o.value === storageEncoding);
      const label = originalOpt?.label ?? opt.label;

      // Special case: if this option is the other axis's column, show swap hint
      const isOtherAxisColumn = opt.value === otherAxisAlias;
      let description: string | undefined;
      if (isOtherAxisColumn && onSwapAxes) {
        description = "↔️ Swap axes";
      } else if (opt.warning) {
        description = `⚠️ ${opt.warning.message}`;
      }

      return {
        label,
        value: storageEncoding ?? opt.value,
        description,
        icon: getColumnIcon(opt.value, columnAnalysis, metricAliases),
      };
    });

    // If the current value is invalid but still selected, include it in the options
    // so the user can see what's selected and understand the error message.
    // This prevents the select from appearing blank when an invalid option is selected.
    const currentAlias = toSqlAlias(value);
    if (value && currentAlias && !validAliasSet.has(currentAlias)) {
      const currentOption = allOptions.find((opt) => opt.value === value);
      if (currentOption) {
        result.unshift({
          label: currentOption.label,
          value: currentOption.value,
          description: "⛔ Invalid for this chart type",
          icon: getColumnIcon(
            currentAlias ?? currentOption.value,
            columnAnalysis,
            metricAliases,
          ),
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
    metricAliases,
    onSwapAxes,
    otherAxisAlias,
    sqlAliasToEncoding,
    toSqlAlias,
    value,
  ]);

  // Check if current selection is valid for this axis/chart type (hard error)
  // Pass storage encoding (field:<uuid>) directly - isColumnValidForChannel expects this format
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
  // Convert storage encodings to SQL aliases for column analysis comparison
  const currentWarning: AxisWarning | null = useMemo(() => {
    // Don't show warning if there's already a validation error
    if (validationError) return null;
    if (!columnAnalysis || !value) return null;
    // Don't show "same column" warning if we'll show swap action instead
    if (isSameAsOtherAxis && onSwapAxes) return null;

    // Convert current value to SQL alias
    const currentAlias = toSqlAlias(value);
    if (!currentAlias) return null;

    // Build otherColumns object using SQL aliases
    let otherColumns: { x?: string; y?: string } | undefined;
    if (otherAxisAlias) {
      otherColumns =
        axis === "x" ? { y: otherAxisAlias } : { x: otherAxisAlias };
    }
    return getColumnWarning(
      currentAlias,
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
    otherAxisAlias,
    validationError,
    isSameAsOtherAxis,
    onSwapAxes,
    toSqlAlias,
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
              <ArrowUpDownIcon className="mr-1 h-3 w-3" />
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
              <AlertCircleIcon className="mr-1 h-3 w-3" />
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
