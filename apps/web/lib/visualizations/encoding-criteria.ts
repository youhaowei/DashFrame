/**
 * Unified encoding criteria for chart suggestions AND axis warnings.
 *
 * This module provides the SINGLE source of truth for determining whether
 * a column is suitable for a given encoding channel (X, Y, color, size).
 *
 * Same functions are used by:
 * - suggest-charts.ts: Filters columns to generate valid suggestions
 * - axis-warnings.ts: Warns users about problematic selections
 */

import type { ColumnAnalysis } from "@dashframe/types";
import { CARDINALITY_THRESHOLDS, looksLikeIdentifier } from "@dashframe/types";
import type { VisualizationType } from "../stores/types";
import type { Field } from "@dashframe/types";

// ============================================================================
// Result Types
// ============================================================================

/**
 * Encoding evaluation result with optional reason for warnings.
 */
export interface EncodingEvaluation {
  /** Whether the column is suitable for this encoding */
  good: boolean;
  /** Reason explaining why (used for warnings when good=false) */
  reason?: string;
}

// ============================================================================
// Blocked Column Detection
// ============================================================================

/** Semantics that should never be used on chart axes */
const BLOCKED_AXIS_SEMANTICS = new Set([
  "identifier",
  "reference",
  "email",
  "url",
  "uuid",
]);

/**
 * Check if a column should be completely blocked from visualization axes.
 *
 * Blocked columns include:
 * - Identifiers (IDs, UUIDs, keys)
 * - References (URLs, emails)
 * - Columns with >50% null values
 *
 * @param col - Column analysis from DuckDB
 * @param field - Optional field metadata (for isIdentifier/isReference flags)
 * @param rowCount - Optional total row count (for null ratio calculation)
 */
export function isBlockedColumn(
  col: ColumnAnalysis,
  field?: Field,
  rowCount?: number,
): EncodingEvaluation {
  // Check semantic (analyzeDataFrame handles ID detection)
  if (BLOCKED_AXIS_SEMANTICS.has(col.semantic)) {
    return {
      good: false,
      reason:
        "This column contains unique identifiers or references that cannot be meaningfully visualized.",
    };
  }

  // Check field metadata for identifier/reference flags (fallback)
  if (field && (field.isIdentifier || field.isReference)) {
    return {
      good: false,
      reason:
        "This column is marked as an identifier or reference and should not be used for axes.",
    };
  }

  // Check column name patterns
  if (looksLikeIdentifier(col.columnName)) {
    return {
      good: false,
      reason:
        "Column name suggests this is an identifier (ID, key, etc.) which is not suitable for visualization.",
    };
  }

  // Skip columns with high null rate (>50% missing data)
  if (rowCount && rowCount > 0 && col.nullCount / rowCount > 0.5) {
    return {
      good: false,
      reason:
        "More than 50% of values are missing. Consider filtering or choosing a different column.",
    };
  }

  return { good: true };
}

// ============================================================================
// X-Axis Criteria
// ============================================================================

/**
 * Check if column is suitable for scatter plot X-axis (requires numerical).
 */
function checkScatterXAxis(col: ColumnAnalysis): EncodingEvaluation {
  if (col.semantic !== "numerical") {
    return {
      good: false,
      reason:
        "Scatter plots need numerical values on both axes to show correlations.",
    };
  }
  return { good: true };
}

/**
 * Check if column is suitable for line/area chart X-axis.
 */
function checkLineAreaXAxis(col: ColumnAnalysis): EncodingEvaluation {
  const { semantic, cardinality } = col;

  if (semantic === "temporal" || semantic === "numerical") {
    return { good: true };
  }

  if (semantic === "categorical" || semantic === "boolean") {
    if (cardinality > CARDINALITY_THRESHOLDS.CATEGORICAL_X_MAX) {
      return {
        good: false,
        reason: `Too many categories (${cardinality}). Line charts work best with time-series or fewer than ${CARDINALITY_THRESHOLDS.CATEGORICAL_X_MAX} categories.`,
      };
    }
    return { good: true };
  }

  return {
    good: false,
    reason: "Line charts work best with time-series or continuous data.",
  };
}

/**
 * Check if column is suitable for bar chart X-axis.
 */
function checkBarXAxis(col: ColumnAnalysis): EncodingEvaluation {
  const { semantic, cardinality } = col;

  if (semantic === "categorical" || semantic === "boolean") {
    if (cardinality <= 1) {
      return {
        good: false,
        reason:
          "This column has only one unique value. Bar charts need categories to compare.",
      };
    }
    if (cardinality > CARDINALITY_THRESHOLDS.CATEGORICAL_X_MAX) {
      return {
        good: false,
        reason: `Too many categories (${cardinality}). Consider using a Histogram or filtering the data.`,
      };
    }
    return { good: true };
  }

  if (semantic === "temporal") {
    return { good: true };
  }

  if (semantic === "numerical") {
    if (cardinality > 20) {
      return {
        good: false,
        reason:
          "Many unique numerical values. Consider a Histogram or Scatter plot instead.",
      };
    }
    return { good: true };
  }

  return { good: true };
}

/**
 * Check if a column is suitable for X-axis based on chart type.
 *
 * Criteria vary by chart type:
 * - Bar: Categorical preferred (1-50 values), temporal also good
 * - Line/Area: Temporal preferred, numerical continuous also good
 * - Scatter: Numerical required
 */
export function isGoodXAxis(
  col: ColumnAnalysis,
  chartType: VisualizationType,
  field?: Field,
  rowCount?: number,
): EncodingEvaluation {
  // First check if blocked
  const blocked = isBlockedColumn(col, field, rowCount);
  if (!blocked.good) return blocked;

  // Route to chart-specific checkers
  if (chartType === "dot") {
    return checkScatterXAxis(col);
  }

  if (chartType === "line" || chartType === "areaY") {
    return checkLineAreaXAxis(col);
  }

  if (chartType === "barY") {
    return checkBarXAxis(col);
  }

  // Default: allow if not blocked
  return { good: true };
}

// ============================================================================
// Y-Axis Criteria
// ============================================================================

/**
 * Check if a column is suitable for Y-axis based on chart type.
 *
 * Y-axis is typically the "measure" (numerical value).
 */
export function isGoodYAxis(
  col: ColumnAnalysis,
  chartType: VisualizationType,
  field?: Field,
  rowCount?: number,
): EncodingEvaluation {
  // First check if blocked
  const blocked = isBlockedColumn(col, field, rowCount);
  if (!blocked.good) return blocked;

  const { semantic } = col;

  // Most chart types want numerical Y-axis
  if (["line", "areaY", "dot", "barY"].includes(chartType)) {
    if (semantic !== "numerical") {
      return {
        good: false,
        reason: `${chartType.charAt(0).toUpperCase() + chartType.slice(1)} charts need numerical values on the Y-axis to show height/position.`,
      };
    }

    // Check for variance
    const variance = hasNumericalVariance(col, rowCount);
    if (!variance.good) return variance;

    return { good: true };
  }

  // Table view doesn't care about Y-axis type
  return { good: true };
}

// ============================================================================
// Color Encoding Criteria
// ============================================================================

/**
 * Check if a column is suitable for color encoding.
 *
 * Color works best with:
 * - Categorical columns with 2-12 unique values
 * - Boolean columns (2 values)
 * - Numerical columns can work for gradients but categories are clearer
 */
export function isGoodColorColumn(
  col: ColumnAnalysis,
  currentEncoding?: { x?: string; y?: string },
): EncodingEvaluation {
  const { semantic, cardinality, columnName } = col;

  // Check if same as X or Y axis (redundant encoding)
  if (currentEncoding) {
    if (columnName === currentEncoding.x || columnName === currentEncoding.y) {
      return {
        good: false,
        reason:
          "This column is already used on an axis. Color works best with a different dimension.",
      };
    }
  }

  // Identifiers/references are bad for color
  if (BLOCKED_AXIS_SEMANTICS.has(semantic)) {
    return {
      good: false,
      reason:
        "Unique IDs or references create too many distinct colors to be meaningful.",
    };
  }

  // Check cardinality
  if (cardinality < CARDINALITY_THRESHOLDS.COLOR_MIN) {
    return {
      good: false,
      reason:
        "This column has only one unique value. Color needs at least 2 values to differentiate.",
    };
  }

  if (cardinality > CARDINALITY_THRESHOLDS.COLOR_MAX) {
    return {
      good: false,
      reason: `Too many categories (${cardinality}). Color legends are hard to read with more than ${CARDINALITY_THRESHOLDS.COLOR_MAX} values.`,
    };
  }

  // Boolean and categorical are ideal for color
  if (semantic === "boolean" || semantic === "categorical") {
    return { good: true };
  }

  // Numerical with low cardinality can work (binned values)
  if (semantic === "numerical") {
    // High cardinality numerical creates gradient, which is OK but not ideal
    if (cardinality > 20) {
      return {
        good: true, // Allow it, but could add a soft warning
        reason: undefined, // No warning for gradients
      };
    }
    return { good: true };
  }

  // Temporal is usually not great for color (too many values)
  if (semantic === "temporal") {
    return {
      good: false,
      reason:
        "Temporal columns typically have too many unique values for color encoding.",
    };
  }

  return { good: true };
}

// ============================================================================
// Numerical Variance Check
// ============================================================================

/**
 * Check if a numerical column has meaningful variance.
 *
 * Columns with all same values or mostly zeros are not useful for charts.
 */
export function hasNumericalVariance(
  col: ColumnAnalysis,
  rowCount?: number,
): EncodingEvaluation {
  // Only numerical columns have min/max/zeroCount stats
  if (col.dataType === "number") {
    // No variance if min === max
    if (col.min === col.max) {
      return {
        good: false,
        reason:
          "All values are the same. Charts need variance to show meaningful patterns.",
      };
    }

    // Check for zero ratio if available
    if (col.zeroCount !== undefined && rowCount && rowCount > 0) {
      if (col.zeroCount / rowCount > 0.8) {
        return {
          good: false,
          reason:
            "More than 80% of values are zero. Consider filtering or choosing a different metric.",
        };
      }
    }

    return { good: true };
  }

  // Fallback: rely on cardinality
  if (col.cardinality <= 1) {
    return {
      good: false,
      reason:
        "This column has only one unique value. Charts need variance to show patterns.",
    };
  }

  return { good: true };
}

// ============================================================================
// Categorical X-Axis Check (for suggestions)
// ============================================================================

/**
 * Check if a categorical column is good for X-axis.
 * Good categorical X-axis columns should have:
 * - More than 1 unique value (has variance)
 * - Not too many unique values (readable chart, typically < 50)
 *
 * This is a convenience wrapper for suggestions that only need a boolean.
 */
export function isSuitableCategoricalXAxis(col: ColumnAnalysis): boolean {
  if (col.cardinality <= 1) return false;
  if (col.cardinality > CARDINALITY_THRESHOLDS.CATEGORICAL_X_MAX) return false;
  return true;
}

/**
 * Check if a column is good for color encoding (boolean convenience wrapper).
 */
export function isSuitableColorColumn(col: ColumnAnalysis): boolean {
  if (col.cardinality < CARDINALITY_THRESHOLDS.COLOR_MIN) return false;
  if (col.cardinality > CARDINALITY_THRESHOLDS.COLOR_MAX) return false;
  if (BLOCKED_AXIS_SEMANTICS.has(col.semantic)) return false;
  return true;
}
