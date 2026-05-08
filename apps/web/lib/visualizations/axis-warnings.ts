import {
  resolveForAnalysis,
  type EncodingResolutionContext,
} from "@dashframe/engine";
import type {
  ColumnAnalysis,
  CompiledInsight,
  VisualizationType,
} from "@dashframe/types";
import { CARDINALITY_THRESHOLDS, looksLikeIdentifier } from "@dashframe/types";

/**
 * Warning message with reason explanation for axis selection
 */
export interface AxisWarning {
  message: string;
  reason: string;
}

/**
 * Column option with ranking score and optional warning
 */
export interface RankedColumnOption {
  label: string;
  value: string;
  score: number;
  warning?: AxisWarning;
}

/**
 * Helper: get the semantic of a column by name
 */
function getColumnSemantic(
  columnName: string | undefined,
  analysis: ColumnAnalysis[],
): ColumnAnalysis["semantic"] | null {
  if (!columnName) return null;
  const col = analysis.find((a) => a.columnName === columnName);
  return col?.semantic ?? null;
}

/**
 * Helper: check if a semantic represents a "dimension" (categorical/temporal)
 */
function isDimensionSemantic(
  semantic: ColumnAnalysis["semantic"] | null,
): boolean {
  return (
    semantic === "categorical" ||
    semantic === "temporal" ||
    semantic === "boolean"
  );
}

/**
 * Helper: check if a semantic represents a "measure" (numerical)
 */
function isMeasureSemantic(
  semantic: ColumnAnalysis["semantic"] | null,
): boolean {
  return semantic === "numerical";
}

/**
 * Encoding channel type - x/y axes or color/size encodings
 */
export type EncodingChannel = "x" | "y" | "color" | "size";

/**
 * Build resolution context from compiled insight.
 */
function buildResolutionContext(
  compiledInsight?: CompiledInsight,
): EncodingResolutionContext {
  return {
    fields: compiledInsight?.dimensions ?? [],
    metrics: compiledInsight?.metrics ?? [],
  };
}

/**
 * Column type flags extracted from analysis
 */
interface ColumnTypeFlags {
  isIdentifier: boolean;
  isReference: boolean;
  isNumerical: boolean;
  isTemporal: boolean;
  isCategorical: boolean;
  isBoolean: boolean;
}

/**
 * Extract column type flags from column analysis
 */
function getColumnTypeFlags(
  col: ColumnAnalysis,
  columnName: string,
): ColumnTypeFlags {
  return {
    isIdentifier:
      col.semantic === "identifier" ||
      looksLikeIdentifier(columnName) ||
      col.semantic === "uuid",
    isReference:
      col.semantic === "reference" ||
      col.semantic === "url" ||
      col.semantic === "email",
    isNumerical: col.semantic === "numerical",
    isTemporal: col.semantic === "temporal",
    isCategorical: col.semantic === "categorical",
    isBoolean: col.semantic === "boolean",
  };
}

/**
 * Get warning for color encoding channel
 */
function getColorWarning(
  columnName: string,
  col: ColumnAnalysis,
  flags: ColumnTypeFlags,
  otherColumns?: { x?: string; y?: string },
): AxisWarning | null {
  if (flags.isIdentifier || flags.isReference) {
    return {
      message: "Not suitable for color",
      reason:
        "Unique IDs or references create too many distinct colors to be meaningful.",
    };
  }

  if (columnName === otherColumns?.x || columnName === otherColumns?.y) {
    return {
      message: "Already used on axis",
      reason:
        "This column is already encoded on an axis. Color works best with a different dimension to add information.",
    };
  }

  if (
    (flags.isCategorical || flags.isBoolean) &&
    col.cardinality > CARDINALITY_THRESHOLDS.COLOR_MAX
  ) {
    return {
      message: "Too many categories",
      reason:
        "More than 12 distinct colors are hard to distinguish. Consider filtering or grouping.",
    };
  }

  if (flags.isNumerical && !flags.isTemporal && col.cardinality > 20) {
    return {
      message: "Consider a categorical column",
      reason:
        "Numerical measures work better on axes. Color is most effective with categories (2-12 values) for clear visual distinction.",
    };
  }

  return null;
}

/**
 * Get warning for size encoding channel
 */
function getSizeWarning(
  columnName: string,
  flags: ColumnTypeFlags,
  otherColumns?: { x?: string; y?: string },
): AxisWarning | null {
  if (!flags.isNumerical) {
    return {
      message: "Numerical column recommended",
      reason: "Size encoding requires numerical values to map to point sizes.",
    };
  }

  if (columnName === otherColumns?.x || columnName === otherColumns?.y) {
    return {
      message: "Already used on axis",
      reason: "Using the same column for both axis and size is redundant.",
    };
  }

  return null;
}

/**
 * Get warning for bar chart axis placement
 */
function getBarChartWarning(
  columnName: string,
  col: ColumnAnalysis,
  flags: ColumnTypeFlags,
  axis: "x" | "y",
  otherAxisColumn: string | undefined,
  otherAxisSemantic: ColumnAnalysis["semantic"] | null,
): AxisWarning | null {
  if (flags.isIdentifier || flags.isReference) {
    return {
      message: "Not suitable for bar charts",
      reason:
        "This column contains unique labels or IDs. Bar charts work best with categorical dimensions or numerical measures.",
    };
  }

  if (isMeasureSemantic(otherAxisSemantic) && flags.isNumerical) {
    return {
      message: "Consider a categorical column",
      reason:
        "The other axis already has a numerical measure. Bar charts need one dimension (categorical/temporal) and one measure (numerical).",
    };
  }

  if (isDimensionSemantic(otherAxisSemantic) && !flags.isNumerical) {
    return {
      message: "Numerical column recommended",
      reason:
        "The other axis already has a categorical dimension. Bar charts need a numerical measure on the other axis.",
    };
  }

  if (!otherAxisColumn && flags.isNumerical && col.cardinality > 20) {
    return {
      message: "Many unique values",
      reason:
        "A numerical column with many values might be better suited for a Histogram or Scatter plot.",
    };
  }

  return null;
}

/**
 * Get warning for Y-axis in non-bar charts
 */
function getYAxisWarning(
  flags: ColumnTypeFlags,
  chartType: VisualizationType,
): AxisWarning | null {
  if (flags.isIdentifier || flags.isReference) {
    return {
      message: "Not a measurable value",
      reason:
        "This column contains unique labels or IDs, which cannot be aggregated (sum/avg) meaningfully.",
    };
  }

  if (["line", "areaY", "dot"].includes(chartType) && !flags.isNumerical) {
    const chartName = chartType.charAt(0).toUpperCase() + chartType.slice(1);
    return {
      message: "Numerical column recommended",
      reason: `${chartName} charts need numerical values on the Y-axis to show height, trends, or position.`,
    };
  }

  return null;
}

/**
 * Get warning for X-axis in non-bar charts
 */
function getXAxisWarning(
  col: ColumnAnalysis,
  flags: ColumnTypeFlags,
  chartType: VisualizationType,
): AxisWarning | null {
  if (chartType === "dot" && !flags.isNumerical) {
    return {
      message: "Numerical column recommended",
      reason:
        "Scatter plots need numerical values on both axes to show correlations between two measures.",
    };
  }

  if (chartType === "line" || chartType === "areaY") {
    if (flags.isCategorical && col.cardinality > 20) {
      return {
        message: "Too many categories",
        reason:
          "Line charts with many categories can look cluttered. Consider a Bar chart or filtering.",
      };
    }

    if (!flags.isTemporal && !flags.isNumerical && !flags.isCategorical) {
      return {
        message: "Ordered column recommended",
        reason: "Line charts work best with time-series or continuous data.",
      };
    }
  }

  return null;
}

/**
 * Get a warning message for a column selection based on analysis and context.
 *
 * Evaluates whether a column is appropriate for a given encoding channel and chart type,
 * returning a user-friendly warning message if the selection is problematic.
 *
 * This function works with COLUMN NAMES (not EncodingValue strings). For EncodingValue
 * validation, use getEncodingWarning instead.
 *
 * @param columnName - The selected column name
 * @param channel - Which encoding channel ("x", "y", "color", or "size")
 * @param chartType - The current visualization type
 * @param analysis - Column analysis data (should include metrics as numerical)
 * @param otherColumns - Other columns currently selected (for detecting duplicates)
 * @returns Warning object with message and reason, or null if selection is fine
 */
export function getColumnWarning(
  columnName: string | undefined,
  channel: EncodingChannel,
  chartType: VisualizationType,
  analysis: ColumnAnalysis[],
  otherColumns?: { x?: string; y?: string; color?: string; size?: string },
): AxisWarning | null {
  if (!columnName) return null;

  const col = analysis.find((a) => a.columnName === columnName);
  if (!col) return null;

  const flags = getColumnTypeFlags(col, columnName);

  // Handle color and size channels
  if (channel === "color") {
    return getColorWarning(columnName, col, flags, otherColumns);
  }

  if (channel === "size") {
    return getSizeWarning(columnName, flags, otherColumns);
  }

  // Handle x/y axis channels
  const axis = channel as "x" | "y";
  let otherAxisColumn: string | undefined;
  if (channel === "x") {
    otherAxisColumn = otherColumns?.y;
  } else if (channel === "y") {
    otherAxisColumn = otherColumns?.x;
  }

  if (otherAxisColumn && columnName === otherAxisColumn) {
    return {
      message: "Same column on both axes",
      reason:
        "Comparing a column to itself usually doesn't show meaningful insights.",
    };
  }

  if (chartType === "barY") {
    const otherAxisSemantic = getColumnSemantic(otherAxisColumn, analysis);
    return getBarChartWarning(
      columnName,
      col,
      flags,
      axis,
      otherAxisColumn,
      otherAxisSemantic,
    );
  }

  if (axis === "y") {
    return getYAxisWarning(flags, chartType);
  }

  if (axis === "x") {
    return getXAxisWarning(col, flags, chartType);
  }

  return null;
}

/**
 * Get a warning message for an encoding value (field:uuid or metric:uuid).
 *
 * This function validates EncodingValue strings against chart type constraints
 * and returns appropriate warnings for soft issues.
 *
 * @param encodingValue - The encoding value (field:uuid or metric:uuid)
 * @param channel - Which encoding channel ("x", "y", "color", or "size")
 * @param chartType - The current visualization type
 * @param analysis - Column analysis data
 * @param compiledInsight - The compiled insight (provides fields and metrics)
 * @param otherAxisEncodingValue - The encoding value on the other axis (for detecting same-column warnings)
 * @returns Warning object with message and reason, or null if selection is fine
 */
export function getEncodingWarning(
  encodingValue: string | undefined,
  channel: EncodingChannel,
  chartType: VisualizationType,
  analysis: ColumnAnalysis[],
  compiledInsight?: CompiledInsight,
  otherAxisEncodingValue?: string,
): AxisWarning | null {
  if (!encodingValue) return null;

  const context = buildResolutionContext(compiledInsight);
  const resolved = resolveForAnalysis(encodingValue, context);

  // Invalid encoding format - return warning (validation handles this as error)
  if (!resolved.valid) {
    return {
      message: "Invalid encoding",
      reason: "This encoding value has an invalid format.",
    };
  }

  // Metrics are treated as numerical for warning purposes
  if (resolved.isMetric) {
    // Check if same as other axis (encoded by the same metric ID)
    if (otherAxisEncodingValue && encodingValue === otherAxisEncodingValue) {
      return {
        message: "Same metric on both axes",
        reason:
          "Comparing a metric to itself usually doesn't show meaningful insights.",
      };
    }

    // Metrics are always valid for numerical contexts - no warnings needed
    // (Validation handles whether metrics are allowed on specific axes)
    return null;
  }

  // For fields, delegate to column-based warning logic
  if (!resolved.columnName) {
    return {
      message: "Field not found",
      reason: "The referenced field could not be resolved.",
    };
  }

  // Resolve other axis encoding to column name for comparison
  let otherAxisColumnName: string | undefined;
  if (otherAxisEncodingValue) {
    const otherResolved = resolveForAnalysis(otherAxisEncodingValue, context);
    if (otherResolved.valid && !otherResolved.isMetric) {
      otherAxisColumnName = otherResolved.columnName;
    }
  }

  // Build otherColumns object for column-based warning logic
  let otherColumns: { x?: string; y?: string } | undefined;
  if (channel === "x") {
    otherColumns = { y: otherAxisColumnName };
  } else if (channel === "y") {
    otherColumns = { x: otherAxisColumnName };
  }

  return getColumnWarning(
    resolved.columnName,
    channel,
    chartType,
    analysis,
    otherColumns,
  );
}

// ============================================================================
// Column Scoring Helpers
// ============================================================================

// Note: Reuses ColumnTypeFlags interface defined above (lines 81-89)

/**
 * Score a column for vertical bar chart axis placement.
 * X axis prefers categorical/temporal dimensions, Y axis prefers numerical measures.
 *
 * @param axis - Target axis ("x" or "y")
 * @param flags - Column type classification flags
 * @returns Score adjustment (positive = good fit, negative = poor fit)
 */
function scoreBarVertical(axis: "x" | "y", flags: ColumnTypeFlags): number {
  let score = 0;
  if (axis === "x") {
    // X axis needs categorical or temporal dimensions
    if (flags.isCategorical) score += 100;
    if (flags.isTemporal) score += 80;
    if (flags.isNumerical) score -= 50;
  } else {
    // Y axis needs metrics (numerical aggregations)
    if (flags.isNumerical) score += 100;
    if (!flags.isNumerical) score -= 50;
  }
  if (flags.isIdentifier) score -= 100;
  return score;
}

/**
 * Score a column for horizontal bar chart axis placement.
 * X axis prefers numerical measures, Y axis prefers categorical/temporal dimensions.
 * (Inverted from vertical bar chart)
 *
 * @param axis - Target axis ("x" or "y")
 * @param flags - Column type classification flags
 * @returns Score adjustment (positive = good fit, negative = poor fit)
 */
function scoreBarHorizontal(axis: "x" | "y", flags: ColumnTypeFlags): number {
  let score = 0;
  if (axis === "x") {
    // X axis needs metrics (numerical aggregations)
    if (flags.isNumerical) score += 100;
    if (!flags.isNumerical) score -= 50;
  } else {
    // Y axis needs categorical or temporal dimensions
    if (flags.isCategorical) score += 100;
    if (flags.isTemporal) score += 80;
    if (flags.isNumerical) score -= 50;
  }
  if (flags.isIdentifier) score -= 100;
  return score;
}

/**
 * Score a column for Y axis in line/area/scatter charts.
 * Y axis strongly prefers numerical columns for all these chart types.
 *
 * @param chartType - The visualization type (line, area, scatter, etc.)
 * @param flags - Column type classification flags
 * @returns Score adjustment (positive = good fit, negative = poor fit)
 */
function scoreYAxisNonBar(
  chartType: VisualizationType,
  flags: ColumnTypeFlags,
): number {
  let score = 0;
  if (flags.isNumerical) score += 100;
  if (!flags.isNumerical && ["line", "areaY", "dot"].includes(chartType)) {
    score -= 50;
  }
  if (flags.isIdentifier) score -= 100;
  return score;
}

/**
 * Score a column for X axis in line/area/scatter charts.
 * Line/area prefer temporal, scatter requires numerical.
 *
 * @param chartType - The visualization type (line, area, scatter, etc.)
 * @param flags - Column type classification flags
 * @returns Score adjustment (positive = good fit, negative = poor fit)
 */
function scoreXAxisNonBar(
  chartType: VisualizationType,
  flags: ColumnTypeFlags,
): number {
  let score = 0;
  if (chartType === "line" || chartType === "areaY") {
    if (flags.isTemporal) score += 100;
    if (flags.isNumerical) score += 60;
    if (flags.isCategorical) score += 20;
  } else if (chartType === "dot") {
    if (flags.isNumerical) score += 100;
    if (!flags.isNumerical) score -= 50;
  }
  return score;
}

/**
 * Calculate overall suitability score for a column on a given axis.
 * Combines chart-type-specific scoring with general penalties for warnings
 * and duplicate axis usage.
 *
 * @param axis - Target axis ("x" or "y")
 * @param chartType - The visualization type
 * @param flags - Column type classification flags
 * @param hasWarning - Whether the column has a warning for this placement
 * @param isSameAsOtherAxis - Whether this column is already used on the other axis
 * @returns Final score (higher = more suitable)
 */
function calculateColumnScore(
  axis: "x" | "y",
  chartType: VisualizationType,
  flags: ColumnTypeFlags,
  hasWarning: boolean,
  isSameAsOtherAxis: boolean,
): number {
  let score = 50; // Base score

  // Chart-type specific scoring
  if (chartType === "barY") {
    score += scoreBarVertical(axis, flags);
  } else if (chartType === "barX") {
    score += scoreBarHorizontal(axis, flags);
  } else if (axis === "y") {
    score += scoreYAxisNonBar(chartType, flags);
  } else {
    score += scoreXAxisNonBar(chartType, flags);
  }

  // General penalties
  if (isSameAsOtherAxis) score -= 200;
  if (hasWarning) score -= 50;

  return score;
}

/**
 * Create column options ranked by suitability with inline warning indicators.
 *
 * Scores each column based on how appropriate it is for the given axis and chart type,
 * then sorts them by score (best options first). Each option includes its warning if any.
 *
 * This function works with COLUMN NAMES (not EncodingValue strings). The caller should
 * convert column names to EncodingValue strings when building UI options.
 *
 * @param columns - Array of column names
 * @param axis - Which axis to rank for ("x" or "y")
 * @param chartType - The current visualization type
 * @param analysis - Column analysis data from analyzeDataFrame
 * @param otherAxisColumn - The column currently selected for the other axis
 * @returns Sorted array of column options with scores and warnings
 */
export function getRankedColumnOptions(
  columns: string[],
  axis: "x" | "y",
  chartType: VisualizationType,
  analysis: ColumnAnalysis[],
  otherAxisColumn?: string,
): RankedColumnOption[] {
  // Build otherColumns object: if we're configuring X, otherAxisColumn goes on Y, and vice versa
  let otherColumns: { x?: string; y?: string } | undefined;
  if (otherAxisColumn) {
    otherColumns =
      axis === "x" ? { y: otherAxisColumn } : { x: otherAxisColumn };
  }

  return columns
    .map((col) => {
      const warning = getColumnWarning(
        col,
        axis,
        chartType,
        analysis,
        otherColumns,
      );
      const colAnalysis = analysis.find((a) => a.columnName === col);

      if (!colAnalysis) {
        return {
          label: col,
          value: col,
          score: 0,
          warning: warning || undefined,
        };
      }

      const flags = getColumnTypeFlags(colAnalysis, col);

      const score = calculateColumnScore(
        axis,
        chartType,
        flags,
        !!warning,
        col === otherAxisColumn,
      );

      return { label: col, value: col, score, warning: warning || undefined };
    })
    .sort((a, b) => b.score - a.score); // Sort by score descending
}
