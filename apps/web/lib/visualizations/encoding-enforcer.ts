/**
 * Encoding Enforcer
 *
 * Provides hard validation for chart encoding configurations based on vgplot
 * mark requirements. Each chart type has specific axis constraints:
 *
 * - bar (vertical): X = dimension (field), Y = metric (aggregation)
 * - barHorizontal: X = metric (aggregation), Y = dimension (field)
 * - line/area: X = continuous (temporal/numerical), Y = metric (aggregation)
 * - scatter: X = continuous, Y = continuous
 *
 * IMPORTANT: For bar and line/area charts, the "value" axis must be a **metric**
 * (an explicit aggregation from insight.metrics like SUM, COUNT, AVG).
 * Raw columns from selectedFields are dimensions, not metrics.
 *
 * This module enforces these constraints by filtering valid columns for each
 * channel and validating complete encoding configurations.
 */

import type { ColumnAnalysis } from "@dashframe/engine-browser";
import { looksLikeIdentifier } from "@dashframe/engine-browser";
import type { VisualizationType, CompiledInsight } from "@dashframe/types";

// ============================================================================
// Types
// ============================================================================

/**
 * Encoding channel for axis selection
 */
export type EncodingChannel = "x" | "y" | "color" | "size";

/**
 * Result of encoding validation
 */
export interface EncodingValidationResult {
  isValid: boolean;
  blockReason?: string;
}

/**
 * Column suitability for a channel
 */
export interface ColumnSuitability {
  suitable: boolean;
  reason?: string;
}

// ============================================================================
// Column Category Helpers
// ============================================================================

/** Categories that are always blocked from axes */
const BLOCKED_CATEGORIES = new Set([
  "identifier",
  "reference",
  "email",
  "url",
  "uuid",
]);

/**
 * Check if a column is categorically blocked (identifiers, references, etc.)
 */
function isBlockedCategory(col: ColumnAnalysis): boolean {
  if (BLOCKED_CATEGORIES.has(col.category)) return true;
  if (looksLikeIdentifier(col.columnName)) return true;
  return false;
}

/**
 * Check if a column is categorical (discrete, unordered)
 */
function isCategorical(col: ColumnAnalysis): boolean {
  return col.category === "categorical" || col.category === "boolean";
}

/**
 * Check if a column is continuous (ordered, interpolatable)
 */
function isContinuous(col: ColumnAnalysis): boolean {
  return col.category === "temporal" || col.category === "numerical";
}

/**
 * Check if a column is temporal
 */
function isTemporal(col: ColumnAnalysis): boolean {
  return col.category === "temporal";
}

// ============================================================================
// Metric Detection from Insight
// ============================================================================

/**
 * Build a set of metric names from a compiled insight.
 * Metrics are the aggregated columns (SUM, COUNT, AVG, etc.).
 */
function getMetricNames(compiledInsight?: CompiledInsight): Set<string> {
  if (!compiledInsight?.metrics) return new Set();
  return new Set(compiledInsight.metrics.map((m) => m.name));
}

/**
 * Check if a column is a metric (aggregation) from the insight.
 */
function isMetric(columnName: string, metricNames: Set<string>): boolean {
  return metricNames.has(columnName);
}

// ============================================================================
// Channel Validation by Chart Type
// ============================================================================

/**
 * Check if a column is valid for bar chart X axis (vertical bar)
 * X should be a dimension (categorical or temporal field from selectedFields)
 */
function isValidBarX(
  col: ColumnAnalysis,
  metricNames: Set<string>,
): ColumnSuitability {
  if (isBlockedCategory(col)) {
    return {
      suitable: false,
      reason: "Identifiers cannot be used as categories",
    };
  }
  // X axis should NOT be a metric - it should be a dimension
  if (isMetric(col.columnName, metricNames)) {
    return {
      suitable: false,
      reason: "Bar chart X axis needs a dimension, not a metric",
    };
  }
  if (isCategorical(col) || isTemporal(col)) {
    return { suitable: true };
  }
  return {
    suitable: false,
    reason: "Bar chart X axis needs a category or date",
  };
}

/**
 * Check if a column is valid for bar chart Y axis (vertical bar)
 * Y should be a metric (aggregation from insight.metrics)
 */
function isValidBarY(
  col: ColumnAnalysis,
  metricNames: Set<string>,
): ColumnSuitability {
  if (isBlockedCategory(col)) {
    return { suitable: false, reason: "Identifiers cannot be used as values" };
  }
  // Y axis MUST be a metric for bar charts
  if (isMetric(col.columnName, metricNames)) {
    return { suitable: true };
  }
  return {
    suitable: false,
    reason:
      "Bar chart Y axis needs a metric (add an aggregation in the insight)",
  };
}

/**
 * Check if a column is valid for horizontal bar X axis
 * X should be a metric (aggregation from insight.metrics)
 */
function isValidBarHorizontalX(
  col: ColumnAnalysis,
  metricNames: Set<string>,
): ColumnSuitability {
  if (isBlockedCategory(col)) {
    return { suitable: false, reason: "Identifiers cannot be used as values" };
  }
  // X axis MUST be a metric for horizontal bar charts
  if (isMetric(col.columnName, metricNames)) {
    return { suitable: true };
  }
  return {
    suitable: false,
    reason:
      "Horizontal bar X axis needs a metric (add an aggregation in the insight)",
  };
}

/**
 * Check if a column is valid for horizontal bar Y axis
 * Y should be a dimension (categorical or temporal field from selectedFields)
 */
function isValidBarHorizontalY(
  col: ColumnAnalysis,
  metricNames: Set<string>,
): ColumnSuitability {
  if (isBlockedCategory(col)) {
    return {
      suitable: false,
      reason: "Identifiers cannot be used as categories",
    };
  }
  // Y axis should NOT be a metric - it should be a dimension
  if (isMetric(col.columnName, metricNames)) {
    return {
      suitable: false,
      reason: "Horizontal bar Y axis needs a dimension, not a metric",
    };
  }
  if (isCategorical(col) || isTemporal(col)) {
    return { suitable: true };
  }
  return {
    suitable: false,
    reason: "Horizontal bar Y axis needs a category or date",
  };
}

/**
 * Check if a column is valid for line/area X axis
 * X should be continuous (temporal or numerical dimension)
 */
function isValidLineAreaX(
  col: ColumnAnalysis,
  metricNames: Set<string>,
): ColumnSuitability {
  if (isBlockedCategory(col)) {
    return { suitable: false, reason: "Identifiers cannot be used on axes" };
  }
  // X axis should NOT be a metric for line/area - it's the time/continuous dimension
  if (isMetric(col.columnName, metricNames)) {
    return {
      suitable: false,
      reason: "Line/Area X axis needs a dimension, not a metric",
    };
  }
  if (isContinuous(col)) {
    return { suitable: true };
  }
  return {
    suitable: false,
    reason: "Line/Area X axis needs a date or number (continuous)",
  };
}

/**
 * Check if a column is valid for line/area Y axis
 * Y should be a metric (aggregation from insight.metrics)
 */
function isValidLineAreaY(
  col: ColumnAnalysis,
  metricNames: Set<string>,
): ColumnSuitability {
  if (isBlockedCategory(col)) {
    return { suitable: false, reason: "Identifiers cannot be used as values" };
  }
  // Y axis MUST be a metric for line/area charts
  if (isMetric(col.columnName, metricNames)) {
    return { suitable: true };
  }
  return {
    suitable: false,
    reason:
      "Line/Area Y axis needs a metric (add an aggregation in the insight)",
  };
}

/**
 * Check if a column is valid for scatter X/Y axis
 * Both axes should be continuous (temporal or numerical)
 * Scatter plots can use both metrics and dimensions
 */
function isValidScatterAxis(col: ColumnAnalysis): ColumnSuitability {
  if (isBlockedCategory(col)) {
    return { suitable: false, reason: "Identifiers cannot be used on axes" };
  }
  if (isContinuous(col)) {
    return { suitable: true };
  }
  return {
    suitable: false,
    reason: "Scatter plot axes need dates or numbers (continuous)",
  };
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Get columns that are valid for a specific channel and chart type.
 *
 * This is the primary function for filtering dropdown options in the UI.
 * It returns only columns that satisfy the hard constraints for the given
 * chart type and axis.
 *
 * @param channel - The encoding channel ("x" or "y")
 * @param chartType - The visualization type
 * @param analysis - Column analysis data from DuckDB
 * @param compiledInsight - The compiled insight (provides metrics vs dimensions distinction)
 * @returns Array of column names that are valid for this channel
 */
export function getValidColumnsForChannel(
  channel: EncodingChannel,
  chartType: VisualizationType,
  analysis: ColumnAnalysis[],
  compiledInsight?: CompiledInsight,
): string[] {
  // Color and size have different rules (handled elsewhere)
  if (channel === "color" || channel === "size") {
    return analysis.map((col) => col.columnName);
  }

  const metricNames = getMetricNames(compiledInsight);
  const validatorFn = getValidatorFunction(channel, chartType, metricNames);

  return analysis
    .filter((col) => validatorFn(col).suitable)
    .map((col) => col.columnName);
}

/**
 * Check if a specific column is valid for a channel and chart type.
 *
 * @param columnName - The column to check
 * @param channel - The encoding channel
 * @param chartType - The visualization type
 * @param analysis - Column analysis data
 * @param compiledInsight - The compiled insight (provides metrics vs dimensions distinction)
 * @returns Suitability result with reason if not suitable
 */
export function isColumnValidForChannel(
  columnName: string,
  channel: EncodingChannel,
  chartType: VisualizationType,
  analysis: ColumnAnalysis[],
  compiledInsight?: CompiledInsight,
): ColumnSuitability {
  const col = analysis.find((c) => c.columnName === columnName);
  if (!col) {
    return { suitable: false, reason: "Column not found" };
  }

  // Color and size have looser constraints
  if (channel === "color" || channel === "size") {
    return { suitable: true };
  }

  const metricNames = getMetricNames(compiledInsight);
  const validatorFn = getValidatorFunction(channel, chartType, metricNames);
  return validatorFn(col);
}

/**
 * Get the validator function for a channel and chart type combination.
 */
function getValidatorFunction(
  channel: EncodingChannel,
  chartType: VisualizationType,
  metricNames: Set<string>,
): (col: ColumnAnalysis) => ColumnSuitability {
  switch (chartType) {
    case "bar":
      return channel === "x"
        ? (col) => isValidBarX(col, metricNames)
        : (col) => isValidBarY(col, metricNames);
    case "barHorizontal":
      return channel === "x"
        ? (col) => isValidBarHorizontalX(col, metricNames)
        : (col) => isValidBarHorizontalY(col, metricNames);
    case "line":
    case "area":
      return channel === "x"
        ? (col) => isValidLineAreaX(col, metricNames)
        : (col) => isValidLineAreaY(col, metricNames);
    case "scatter":
      return isValidScatterAxis;
    default:
      // Fallback: allow anything that's not blocked
      return (col) => ({
        suitable: !isBlockedCategory(col),
        reason: isBlockedCategory(col)
          ? "Identifiers cannot be used"
          : undefined,
      });
  }
}

/**
 * Validate encoding configuration and return any errors.
 *
 * Returns an object with x and y error messages (if any).
 * Used to show errors on the chart when encoding is invalid.
 */
export function validateEncoding(
  encoding: { x?: string; y?: string },
  chartType: VisualizationType,
  analysis: ColumnAnalysis[],
  compiledInsight?: CompiledInsight,
): { x?: string; y?: string } {
  const errors: { x?: string; y?: string } = {};

  if (encoding.x && analysis.length > 0) {
    const result = isColumnValidForChannel(
      encoding.x,
      "x",
      chartType,
      analysis,
      compiledInsight,
    );
    if (!result.suitable) {
      errors.x = result.reason;
    }
  }

  if (encoding.y && analysis.length > 0) {
    const result = isColumnValidForChannel(
      encoding.y,
      "y",
      chartType,
      analysis,
      compiledInsight,
    );
    if (!result.suitable) {
      errors.y = result.reason;
    }
  }

  return errors;
}

/**
 * Check if swapping axes is allowed for a chart type.
 *
 * - Bar charts: swap toggles between vertical and horizontal
 * - Scatter: swap is allowed (both axes accept same types)
 * - Line/Area: swap is NOT allowed (asymmetric constraints)
 */
export function isSwapAllowed(chartType: VisualizationType): boolean {
  switch (chartType) {
    case "bar":
    case "barHorizontal":
    case "scatter":
      return true;
    case "line":
    case "area":
      return false;
    default:
      return false;
  }
}

/**
 * Get the chart type that results from swapping axes.
 *
 * For bar charts, swapping toggles between vertical and horizontal.
 * For other chart types, the type remains the same.
 */
export function getSwappedChartType(
  chartType: VisualizationType,
): VisualizationType {
  switch (chartType) {
    case "bar":
      return "barHorizontal";
    case "barHorizontal":
      return "bar";
    default:
      return chartType;
  }
}

/**
 * Get semantic label for an axis based on chart type.
 *
 * These labels help users understand what type of data belongs on each axis.
 */
export function getAxisSemanticLabel(
  axis: "x" | "y",
  chartType: VisualizationType,
): string {
  switch (chartType) {
    case "bar":
      return axis === "x" ? "Category" : "Value";
    case "barHorizontal":
      return axis === "x" ? "Value" : "Category";
    case "line":
    case "area":
      return axis === "x" ? "Continuous" : "Measure";
    case "scatter":
      return "Continuous";
    default:
      return "";
  }
}
