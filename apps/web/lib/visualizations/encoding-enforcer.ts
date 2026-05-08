/**
 * Encoding Enforcer
 *
 * Provides hard validation for chart encoding configurations based on vgplot
 * mark requirements. Each chart type has specific axis constraints:
 *
 * - barY (vertical): X = dimension (field), Y = metric (aggregation)
 * - barX (horizontal): X = metric (aggregation), Y = dimension (field)
 * - line/areaY: X = continuous (temporal/numerical), Y = metric (aggregation)
 * - dot (scatter): X = continuous, Y = continuous (metrics treated as numerical)
 *
 * IMPORTANT: For bar and line/area charts, the "value" axis must be a **metric**
 * (an explicit aggregation from insight.metrics like SUM, COUNT, AVG).
 * Raw columns from selectedFields are dimensions, not metrics.
 *
 * This module enforces these constraints by filtering valid columns for each
 * channel and validating complete encoding configurations.
 */

import {
  resolveForAnalysis,
  type EncodingResolutionContext,
} from "@dashframe/engine";
import type {
  ColumnAnalysis,
  CompiledInsight,
  VisualizationType,
} from "@dashframe/types";
import { looksLikeIdentifier } from "@dashframe/types";

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

/** Semantics that are always blocked from axes */
const BLOCKED_SEMANTICS = new Set([
  "identifier",
  "reference",
  "email",
  "url",
  "uuid",
]);

/**
 * Check if a column has blocked semantic (identifiers, references, etc.)
 */
function isBlockedSemantic(col: ColumnAnalysis): boolean {
  if (BLOCKED_SEMANTICS.has(col.semantic)) return true;
  if (looksLikeIdentifier(col.columnName)) return true;
  return false;
}

/**
 * Check if a column is categorical (discrete, unordered)
 */
function isCategorical(col: ColumnAnalysis): boolean {
  return col.semantic === "categorical" || col.semantic === "boolean";
}

/**
 * Check if a column is continuous (ordered, interpolatable)
 */
function isContinuous(col: ColumnAnalysis): boolean {
  return col.semantic === "temporal" || col.semantic === "numerical";
}

/**
 * Check if a column is temporal
 */
function isTemporal(col: ColumnAnalysis): boolean {
  return col.semantic === "temporal";
}

// ============================================================================
// Resolution Context Builder
// ============================================================================

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
 * Build a set of metric IDs from a compiled insight for quick lookup.
 */
function getMetricIds(compiledInsight?: CompiledInsight): Set<string> {
  if (!compiledInsight?.metrics) return new Set();
  return new Set(compiledInsight.metrics.map((m) => m.id));
}

// ============================================================================
// Channel Validation by Chart Type (New Encoding Format)
// ============================================================================

/**
 * Validate encoding value for bar chart X axis (vertical bar).
 * X should be a dimension (categorical or temporal field from selectedFields).
 */
function validateBarX(
  encodingValue: string | undefined,
  analysis: ColumnAnalysis[],
  context: EncodingResolutionContext,
): ColumnSuitability {
  if (!encodingValue) {
    return { suitable: false, reason: "No column selected" };
  }

  const resolved = resolveForAnalysis(encodingValue, context);

  // Invalid encoding format (not field: or metric:)
  if (!resolved.valid) {
    return { suitable: false, reason: "Invalid encoding format" };
  }

  // X axis should NOT be a metric - it should be a dimension
  if (resolved.isMetric) {
    return {
      suitable: false,
      reason: "Bar chart X axis needs a dimension, not a metric",
    };
  }

  // For fields, lookup ColumnAnalysis
  if (!resolved.columnName) {
    return { suitable: false, reason: "Field not found" };
  }

  const col = analysis.find((c) => c.columnName === resolved.columnName);
  if (!col) {
    return { suitable: false, reason: "Column not found in analysis" };
  }

  if (isBlockedSemantic(col)) {
    return {
      suitable: false,
      reason: "Identifiers cannot be used as categories",
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
 * Validate encoding value for bar chart Y axis (vertical bar).
 * Y should be a metric (aggregation from insight.metrics).
 */
function validateBarY(
  encodingValue: string | undefined,
  analysis: ColumnAnalysis[],
  context: EncodingResolutionContext,
): ColumnSuitability {
  if (!encodingValue) {
    return { suitable: false, reason: "No column selected" };
  }

  const resolved = resolveForAnalysis(encodingValue, context);

  // Invalid encoding format
  if (!resolved.valid) {
    return { suitable: false, reason: "Invalid encoding format" };
  }

  // Y axis MUST be a metric for bar charts - metrics are always valid (numerical aggregations)
  if (resolved.isMetric) {
    return { suitable: true };
  }

  // It's a field, not a metric
  return {
    suitable: false,
    reason:
      "Bar chart Y axis needs a metric (add an aggregation in the insight)",
  };
}

/**
 * Validate encoding value for horizontal bar X axis.
 * X should be a metric (aggregation from insight.metrics).
 */
function validateBarHorizontalX(
  encodingValue: string | undefined,
  analysis: ColumnAnalysis[],
  context: EncodingResolutionContext,
): ColumnSuitability {
  if (!encodingValue) {
    return { suitable: false, reason: "No column selected" };
  }

  const resolved = resolveForAnalysis(encodingValue, context);

  // Invalid encoding format
  if (!resolved.valid) {
    return { suitable: false, reason: "Invalid encoding format" };
  }

  // X axis MUST be a metric for horizontal bar charts
  if (resolved.isMetric) {
    return { suitable: true };
  }

  return {
    suitable: false,
    reason:
      "Horizontal bar X axis needs a metric (add an aggregation in the insight)",
  };
}

/**
 * Validate encoding value for horizontal bar Y axis.
 * Y should be a dimension (categorical or temporal field from selectedFields).
 */
function validateBarHorizontalY(
  encodingValue: string | undefined,
  analysis: ColumnAnalysis[],
  context: EncodingResolutionContext,
): ColumnSuitability {
  if (!encodingValue) {
    return { suitable: false, reason: "No column selected" };
  }

  const resolved = resolveForAnalysis(encodingValue, context);

  // Invalid encoding format
  if (!resolved.valid) {
    return { suitable: false, reason: "Invalid encoding format" };
  }

  // Y axis should NOT be a metric - it should be a dimension
  if (resolved.isMetric) {
    return {
      suitable: false,
      reason: "Horizontal bar Y axis needs a dimension, not a metric",
    };
  }

  // For fields, lookup ColumnAnalysis
  if (!resolved.columnName) {
    return { suitable: false, reason: "Field not found" };
  }

  const col = analysis.find((c) => c.columnName === resolved.columnName);
  if (!col) {
    return { suitable: false, reason: "Column not found in analysis" };
  }

  if (isBlockedSemantic(col)) {
    return {
      suitable: false,
      reason: "Identifiers cannot be used as categories",
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
 * Validate encoding value for line/area X axis.
 * X should be continuous (temporal or numerical dimension).
 */
function validateLineAreaX(
  encodingValue: string | undefined,
  analysis: ColumnAnalysis[],
  context: EncodingResolutionContext,
): ColumnSuitability {
  if (!encodingValue) {
    return { suitable: false, reason: "No column selected" };
  }

  const resolved = resolveForAnalysis(encodingValue, context);

  // Invalid encoding format
  if (!resolved.valid) {
    return { suitable: false, reason: "Invalid encoding format" };
  }

  // X axis should NOT be a metric for line/area - it's the time/continuous dimension
  if (resolved.isMetric) {
    return {
      suitable: false,
      reason: "Line/Area X axis needs a dimension, not a metric",
    };
  }

  // For fields, lookup ColumnAnalysis
  if (!resolved.columnName) {
    return { suitable: false, reason: "Field not found" };
  }

  const col = analysis.find((c) => c.columnName === resolved.columnName);
  if (!col) {
    return { suitable: false, reason: "Column not found in analysis" };
  }

  if (isBlockedSemantic(col)) {
    return { suitable: false, reason: "Identifiers cannot be used on axes" };
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
 * Validate encoding value for line/area Y axis.
 * Y should be a metric (aggregation from insight.metrics).
 */
function validateLineAreaY(
  encodingValue: string | undefined,
  analysis: ColumnAnalysis[],
  context: EncodingResolutionContext,
): ColumnSuitability {
  if (!encodingValue) {
    return { suitable: false, reason: "No column selected" };
  }

  const resolved = resolveForAnalysis(encodingValue, context);

  // Invalid encoding format
  if (!resolved.valid) {
    return { suitable: false, reason: "Invalid encoding format" };
  }

  // Y axis MUST be a metric for line/area charts
  if (resolved.isMetric) {
    return { suitable: true };
  }

  return {
    suitable: false,
    reason:
      "Line/Area Y axis needs a metric (add an aggregation in the insight)",
  };
}

/**
 * Validate encoding value for scatter X/Y axis.
 * Both axes should be continuous (temporal or numerical).
 * Scatter plots can use both metrics and dimensions - metrics are treated as numerical.
 */
function validateScatterAxis(
  encodingValue: string | undefined,
  analysis: ColumnAnalysis[],
  context: EncodingResolutionContext,
): ColumnSuitability {
  if (!encodingValue) {
    return { suitable: false, reason: "No column selected" };
  }

  const resolved = resolveForAnalysis(encodingValue, context);

  // Invalid encoding format
  if (!resolved.valid) {
    return { suitable: false, reason: "Invalid encoding format" };
  }

  // Metrics are numerical → valid for scatter axes
  if (resolved.isMetric) {
    return { suitable: true };
  }

  // For fields, check if numerical/temporal
  if (!resolved.columnName) {
    return { suitable: false, reason: "Field not found" };
  }

  const col = analysis.find((c) => c.columnName === resolved.columnName);
  if (!col) {
    return { suitable: false, reason: "Column not found in analysis" };
  }

  if (isBlockedSemantic(col)) {
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
// Legacy Column-Based Validation (for getValidColumnsForChannel)
// ============================================================================

/**
 * Check if a column is valid for bar chart X axis (vertical bar)
 * X should be a dimension (categorical or temporal field from selectedFields)
 */
function isValidBarX(
  col: ColumnAnalysis,
  _metricIds: Set<string>,
): ColumnSuitability {
  if (isBlockedSemantic(col)) {
    return {
      suitable: false,
      reason: "Identifiers cannot be used as categories",
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
 * Y should be a metric - for column filtering, we return false (only metrics are valid)
 */
function isValidBarY(_col: ColumnAnalysis): ColumnSuitability {
  // This function is only for filtering ColumnAnalysis columns
  // Metrics are not in ColumnAnalysis, so we need different logic
  // For column filtering, bar Y axis should only allow metrics (not columns)
  return {
    suitable: false,
    reason:
      "Bar chart Y axis needs a metric (add an aggregation in the insight)",
  };
}

/**
 * Check if a column is valid for horizontal bar X axis
 * X should be a metric - for column filtering, we return false
 */
function isValidBarHorizontalX(_col: ColumnAnalysis): ColumnSuitability {
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
  _metricIds: Set<string>,
): ColumnSuitability {
  if (isBlockedSemantic(col)) {
    return {
      suitable: false,
      reason: "Identifiers cannot be used as categories",
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
function isValidLineAreaX(col: ColumnAnalysis): ColumnSuitability {
  if (isBlockedSemantic(col)) {
    return { suitable: false, reason: "Identifiers cannot be used on axes" };
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
 * Y should be a metric - for column filtering, we return false
 */
function isValidLineAreaY(_col: ColumnAnalysis): ColumnSuitability {
  return {
    suitable: false,
    reason:
      "Line/Area Y axis needs a metric (add an aggregation in the insight)",
  };
}

/**
 * Check if a column is valid for scatter X/Y axis
 * Both axes should be continuous (temporal or numerical)
 */
function isValidScatterAxis(col: ColumnAnalysis): ColumnSuitability {
  if (isBlockedSemantic(col)) {
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
 * This function returns column names (from ColumnAnalysis) that satisfy
 * the hard constraints for the given chart type and axis. It's used for
 * filtering dropdown options in the UI.
 *
 * Note: This returns column names, not EncodingValues. The UI should
 * convert these to EncodingValues (field:uuid) when building options.
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

  const metricIds = getMetricIds(compiledInsight);
  const validColumns: string[] = [];

  // First, add valid columns from ColumnAnalysis (dimensions)
  const validatorFn = getColumnValidatorFunction(channel, chartType, metricIds);
  for (const col of analysis) {
    if (validatorFn(col).suitable) {
      validColumns.push(col.columnName);
    }
  }

  // Then, add metrics for channels that accept them
  const metricsAllowed = isMetricAllowedOnChannel(channel, chartType);
  if (metricsAllowed && compiledInsight?.metrics) {
    for (const metric of compiledInsight.metrics) {
      // Use metric name as the column name (will be resolved to SQL expression later)
      validColumns.push(metric.name);
    }
  }

  return validColumns;
}

/**
 * Check if metrics are allowed on a specific channel for a chart type.
 */
function isMetricAllowedOnChannel(
  channel: EncodingChannel,
  chartType: VisualizationType,
): boolean {
  switch (chartType) {
    case "barY":
      return channel === "y"; // Y axis only
    case "barX":
      return channel === "x"; // X axis only
    case "line":
    case "areaY":
      return channel === "y"; // Y axis only
    case "dot":
      return true; // Both axes allow metrics
    default:
      return false;
  }
}

/**
 * Get the column validator function for filtering ColumnAnalysis entries.
 */
function getColumnValidatorFunction(
  channel: EncodingChannel,
  chartType: VisualizationType,
  metricIds: Set<string>,
): (col: ColumnAnalysis) => ColumnSuitability {
  switch (chartType) {
    case "barY":
      return channel === "x"
        ? (col) => isValidBarX(col, metricIds)
        : () => isValidBarY({} as ColumnAnalysis); // Y axis only allows metrics
    case "barX":
      return channel === "x"
        ? () => isValidBarHorizontalX({} as ColumnAnalysis) // X axis only allows metrics
        : (col) => isValidBarHorizontalY(col, metricIds);
    case "line":
    case "areaY":
      return channel === "x"
        ? isValidLineAreaX
        : () => isValidLineAreaY({} as ColumnAnalysis); // Y axis only allows metrics
    case "dot":
      return isValidScatterAxis;
    default:
      // Fallback: allow anything that's not blocked
      return (col) => ({
        suitable: !isBlockedSemantic(col),
        reason: isBlockedSemantic(col)
          ? "Identifiers cannot be used"
          : undefined,
      });
  }
}

/**
 * Check if a specific encoding value is valid for a channel and chart type.
 *
 * This function validates EncodingValue strings (field:uuid or metric:uuid)
 * against the chart type constraints.
 *
 * @param encodingValue - The encoding value to check (field:uuid or metric:uuid)
 * @param channel - The encoding channel
 * @param chartType - The visualization type
 * @param analysis - Column analysis data
 * @param compiledInsight - The compiled insight (provides fields and metrics)
 * @returns Suitability result with reason if not suitable
 */
export function isColumnValidForChannel(
  encodingValue: string,
  channel: EncodingChannel,
  chartType: VisualizationType,
  analysis: ColumnAnalysis[],
  compiledInsight?: CompiledInsight,
): ColumnSuitability {
  // Color and size have looser constraints
  if (channel === "color" || channel === "size") {
    return { suitable: true };
  }

  const context = buildResolutionContext(compiledInsight);
  return getEncodingValidator(channel, chartType)(
    encodingValue,
    analysis,
    context,
  );
}

/**
 * Get the encoding validator function for a channel and chart type combination.
 */
function getEncodingValidator(
  channel: EncodingChannel,
  chartType: VisualizationType,
): (
  encodingValue: string | undefined,
  analysis: ColumnAnalysis[],
  context: EncodingResolutionContext,
) => ColumnSuitability {
  switch (chartType) {
    case "barY":
      return channel === "x" ? validateBarX : validateBarY;
    case "barX":
      return channel === "x" ? validateBarHorizontalX : validateBarHorizontalY;
    case "line":
    case "areaY":
      return channel === "x" ? validateLineAreaX : validateLineAreaY;
    case "dot":
      return validateScatterAxis;
    default:
      // Fallback: check valid format only
      return (encodingValue, _analysis, context) => {
        const resolved = resolveForAnalysis(encodingValue, context);
        if (!resolved.valid) {
          return { suitable: false, reason: "Invalid encoding format" };
        }
        return { suitable: true };
      };
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
    case "barY":
    case "barX":
    case "dot":
      return true;
    case "line":
    case "areaY":
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
    case "barY":
      return "barX";
    case "barX":
      return "barY";
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
    case "barY":
      return axis === "x" ? "Category" : "Value";
    case "barX":
      return axis === "x" ? "Value" : "Category";
    case "line":
    case "areaY":
      return axis === "x" ? "Continuous" : "Measure";
    case "dot":
      return "Continuous";
    default:
      return "";
  }
}
