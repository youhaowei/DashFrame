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
import {
  extractColumnAliasComponents,
  fieldIdToColumnAlias,
  getMetricDisplayLabel,
  isGeneratedColumnLabel,
  metricIdToColumnAlias,
} from "@dashframe/engine";
import type { ColumnAnalysis } from "@dashframe/engine-browser";
import type {
  CompiledInsight,
  DataFrameColumn,
  Field,
  UUID,
  VisualizationType,
} from "@dashframe/types";
import { fieldEncoding, metricEncoding, parseEncoding } from "@dashframe/types";
import { SelectField } from "@dashframe/ui";
import {
  Badge,
  TooltipPrimitive as Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@wystack/ui";
import { AlertCircleIcon, ArrowUpDownIcon } from "@wystack/ui-icons";
import { useCallback, useMemo } from "react";

/**
 * Match a column analysis entry to a selectable Field using instance-qualified
 * synthetic IDs. For repeat-join instances, `columnAlias` carries a `_j{n}`
 * suffix (e.g. `field_<uuid>_j1`); extractColumnAliasComponents recovers the
 * bare UUID and instance index so we can reconstruct the synthetic field ID
 * (`<uuid>_j1`) and match it against `selectableFields`.
 *
 * Returns `undefined` when no match is found (raw column with no Field).
 */
function matchColumnToField(
  fieldId: string | undefined,
  columnAlias: string,
  selectableFields: Field[],
): Field | undefined {
  if (fieldId) {
    return selectableFields.find((f) => f.id === fieldId);
  }
  const components = extractColumnAliasComponents(columnAlias);
  if (!components) return undefined;
  const syntheticId =
    components.instanceIndex === 0
      ? components.uuid
      : `${components.uuid}_j${components.instanceIndex}`;
  // For repeat-join instances (instanceIndex > 0), only match the exact
  // synthetic ID — do NOT fall back to the bare UUID.  Falling back would
  // collapse the j1 column onto the j0 field, corrupting encodingToSqlAlias
  // and making both instances appear identical in the picker.
  const exactMatch = selectableFields.find((f) => f.id === syntheticId);
  if (exactMatch || components.instanceIndex > 0) return exactMatch;
  // instanceIndex === 0: bare-UUID fallback is safe (no disambiguation needed).
  return selectableFields.find((f) => f.id === components.uuid);
}

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
  /** Available fields for display labels, including metric source columns */
  availableFields?: Field[];
  /** Raw data frame columns used when the insight has no selected dimensions */
  availableColumns?: DataFrameColumn[];
  /** Display labels keyed by generated SQL column alias */
  columnDisplayNames?: Record<string, string>;
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
  availableFields,
  availableColumns,
  columnDisplayNames,
  otherAxisColumn,
  onSwapAxes,
}: AxisSelectFieldProps) {
  const selectableFields = useMemo(() => {
    const fieldsById = new Map<string, Field>();
    for (const field of availableFields ?? []) {
      fieldsById.set(field.id, field);
    }
    for (const field of compiledInsight.dimensions) {
      fieldsById.set(field.id, field);
    }
    return [...fieldsById.values()];
  }, [availableFields, compiledInsight.dimensions]);

  const effectiveCompiledInsight = useMemo(
    () => ({
      ...compiledInsight,
      dimensions: selectableFields,
    }),
    [compiledInsight, selectableFields],
  );

  // Compute all available column options from compiled insight
  // Values use encoding format (field:<uuid>, metric:<uuid>) for storage
  const allOptions = useMemo(() => {
    const options: Array<{ label: string; value: string }> = [];
    const addOption = (option: { label: string; value: string }) => {
      const existing = options.find(
        (current) => current.value === option.value,
      );
      if (!existing) {
        options.push(option);
        return;
      }

      if (
        isGeneratedColumnLabel(existing.label) &&
        !isGeneratedColumnLabel(option.label)
      ) {
        existing.label = option.label;
      }
    };

    // Add dimensions (resolved Field objects)
    // Use field:<uuid> encoding format for value
    selectableFields.forEach((field) => {
      const alias = fieldIdToColumnAlias(field.id);
      const displayLabel = columnDisplayNames?.[alias] ?? field.name;
      addOption({
        label: displayLabel,
        value: fieldEncoding(field.id as UUID),
      });
    });

    // Add metrics using metric:<uuid> encoding format
    compiledInsight.metrics.forEach((metric) => {
      addOption({
        label: getMetricDisplayLabel(metric, selectableFields),
        value: metricEncoding(metric.id as UUID),
      });
    });

    // Resolve labels via stable identifiers only. columnAnalysis,
    // selectableFields, and availableColumns come from different pipelines
    // (DuckDB view analysis vs. compiled insight vs. raw data frame) and are
    // NOT guaranteed to share an order — joins and hidden columns can shift
    // the alignment. Match by fieldId; if that fails, surface the generated
    // alias rather than guessing positionally.
    //
    // For repeat-joins, column.columnName carries the join-instance suffix
    // (e.g. `field_<uuid>_j1`). extractColumnAliasComponents recovers the
    // bare UUID AND the instanceIndex so we can reconstruct the synthetic
    // field ID (`<uuid>_j1` for instanceIndex≥1) and match it against
    // selectableFields — which now carries instance-qualified fields when
    // availableFields comes from buildInsightAvailableFields.
    columnAnalysis.forEach((column) => {
      const matchedField = matchColumnToField(
        column.fieldId,
        column.columnName,
        selectableFields,
      );
      const mappedLabel = columnDisplayNames?.[column.columnName];
      const value = matchedField
        ? fieldEncoding(matchedField.id as UUID)
        : column.columnName;
      let labelToDisplay = column.columnName;
      if (matchedField?.name && !isGeneratedColumnLabel(matchedField.name)) {
        labelToDisplay = matchedField.name;
      }
      if (mappedLabel && !isGeneratedColumnLabel(mappedLabel)) {
        labelToDisplay = mappedLabel;
      }
      addOption({
        label: labelToDisplay,
        value,
      });
    });

    // If analysis is not ready, keep the axis picker usable by exposing raw
    // data frame columns. Rendering maps these labels back to generated SQL
    // aliases when possible.
    for (const column of availableColumns ?? []) {
      addOption({
        label: column.name,
        value: column.name,
      });
    }

    return options;
  }, [
    availableColumns,
    columnAnalysis,
    columnDisplayNames,
    compiledInsight,
    selectableFields,
  ]);

  // Build mapping from storage encoding (field:<uuid>) to SQL alias (field_<uuid>)
  // This allows us to work with columnAnalysis which uses SQL alias format
  const encodingToSqlAlias = useMemo(() => {
    const map = new Map<string, string>();
    selectableFields.forEach((field) => {
      const enc = fieldEncoding(field.id as UUID);
      const alias = fieldIdToColumnAlias(field.id);
      map.set(enc, alias);
    });
    for (const column of columnAnalysis) {
      const matchedField = matchColumnToField(
        column.fieldId,
        column.columnName,
        selectableFields,
      );
      if (matchedField) {
        map.set(fieldEncoding(matchedField.id as UUID), column.columnName);
      } else {
        map.set(column.columnName, column.columnName);
      }
    }
    // Bridge raw data-frame column names to their generated SQL aliases via
    // a stable identifier (the field's underlying columnName), not array
    // position. Positional pairing breaks when joins or hidden columns
    // reorder one pipeline relative to the other.
    (availableColumns ?? []).forEach((column) => {
      const matchedField = selectableFields.find(
        (field) =>
          field.columnName === column.name || field.name === column.name,
      );
      const analyzedColumn = matchedField
        ? columnAnalysis.find(
            (c) =>
              matchColumnToField(c.fieldId, c.columnName, selectableFields)
                ?.id === matchedField.id,
          )?.columnName
        : undefined;
      map.set(column.name, analyzedColumn ?? column.name);
    });
    compiledInsight.metrics.forEach((metric) => {
      const enc = metricEncoding(metric.id as UUID);
      const alias = metricIdToColumnAlias(metric.id);
      map.set(enc, alias);
    });
    return map;
  }, [
    availableColumns,
    columnAnalysis,
    compiledInsight.metrics,
    selectableFields,
  ]);

  // Reverse mapping: SQL alias to storage encoding
  const sqlAliasToEncoding = useMemo(() => {
    const map = new Map<string, string>();
    for (const [enc, alias] of encodingToSqlAlias.entries()) {
      map.set(alias, map.get(alias) ?? enc);
    }
    return map;
  }, [encodingToSqlAlias]);

  // Helper to convert storage encoding to SQL alias
  // Wrapped in useCallback to maintain stable reference for useMemo dependencies
  const toSqlAlias = useCallback(
    (encodingValue: string | undefined): string | undefined => {
      if (!encodingValue) return undefined;
      return encodingToSqlAlias.get(encodingValue) ?? encodingValue;
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
      effectiveCompiledInsight,
    );
    const validAliasSet = new Set(validColumnAliases);

    // Filter options by checking if their SQL alias is valid
    const validOptions = allOptions.filter((opt) => {
      const alias = toSqlAlias(opt.value);
      return alias && validAliasSet.has(alias);
    });

    const validOptionsAreOnlyMetrics =
      validOptions.length > 0 &&
      validOptions.every((opt) => parseEncoding(opt.value)?.type === "metric");
    const shouldUseDimensionFallback =
      axis === "x" &&
      (chartType === "line" || chartType === "areaY") &&
      validOptionsAreOnlyMetrics;
    const optionsForRanking =
      validOptions.length > 0 && !shouldUseDimensionFallback
        ? validOptions
        : allOptions;

    // Get SQL aliases for ranking
    const validAliases = Array.from(
      new Set(
        (shouldUseDimensionFallback ? [] : validOptions)
          .map((opt) => toSqlAlias(opt.value))
          .filter((a): a is string => !!a),
      ),
    );

    if (validAliases.length === 0) {
      return optionsForRanking.map((opt) => {
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
    effectiveCompiledInsight,
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
      effectiveCompiledInsight,
    );
    return result.suitable ? null : result.reason;
  }, [value, axis, chartType, columnAnalysis, effectiveCompiledInsight]);

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
          <TooltipTrigger
            render={
              <Badge
                variant="outline"
                className="cursor-pointer border-palette-info/30 bg-palette-info/10 px-1.5 py-0.5 text-palette-info transition-colors hover:bg-palette-info/20"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSwapAxes();
                }}
              >
                <ArrowUpDownIcon className="mr-1 h-3 w-3" />
                <span className="text-[10px]">Swap</span>
              </Badge>
            }
          />
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
          <TooltipTrigger
            render={
              <Badge
                variant="outline"
                className="border-palette-warning/30 bg-palette-warning/10 px-1.5 py-0.5 text-palette-warning"
              >
                <AlertCircleIcon className="mr-1 h-3 w-3" />
                <span className="text-[10px]">{currentWarning.message}</span>
              </Badge>
            }
          />
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
