import type { ColumnAnalysis } from "@dashframe/engine-browser";
import {
  looksLikeIdentifier,
  CARDINALITY_THRESHOLDS,
} from "@dashframe/engine-browser";
import type { VisualizationType } from "../stores/types";

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
 * Helper: get the category of a column by name
 */
function getColumnCategory(
  columnName: string | undefined,
  analysis: ColumnAnalysis[],
): ColumnAnalysis["category"] | null {
  if (!columnName) return null;
  const col = analysis.find((a) => a.columnName === columnName);
  return col?.category ?? null;
}

/**
 * Helper: check if a category represents a "dimension" (categorical/temporal)
 */
function isDimensionCategory(
  category: ColumnAnalysis["category"] | null,
): boolean {
  return (
    category === "categorical" ||
    category === "temporal" ||
    category === "boolean"
  );
}

/**
 * Helper: check if a category represents a "measure" (numerical)
 */
function isMeasureCategory(
  category: ColumnAnalysis["category"] | null,
): boolean {
  return category === "numerical";
}

/**
 * Encoding channel type - x/y axes or color/size encodings
 */
export type EncodingChannel = "x" | "y" | "color" | "size";

/**
 * Get a warning message for a column selection based on analysis and context.
 *
 * Evaluates whether a column is appropriate for a given encoding channel and chart type,
 * returning a user-friendly warning message if the selection is problematic.
 *
 * @param columnName - The selected column name
 * @param channel - Which encoding channel ("x", "y", "color", or "size")
 * @param chartType - The current visualization type
 * @param analysis - Column analysis data (should include metrics as numerical)
 * @param otherColumns - Other columns currently selected (for detecting duplicates)
 * @returns Warning object with message and reason, or null if selection is fine
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complex by design: evaluates multiple warning conditions based on chart type, axis, and data characteristics
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

  const isIdentifier =
    col.category === "identifier" ||
    looksLikeIdentifier(columnName) ||
    col.category === "uuid";
  const isReference =
    col.category === "reference" ||
    col.category === "url" ||
    col.category === "email";
  const isNumerical = col.category === "numerical";
  const isTemporal = col.category === "temporal";
  const isCategorical = col.category === "categorical";
  const isBoolean = col.category === "boolean";

  // For backwards compatibility: extract otherAxisColumn for x/y logic
  const otherAxisColumn =
    channel === "x"
      ? otherColumns?.y
      : channel === "y"
        ? otherColumns?.x
        : undefined;

  // 1. Color Encoding Logic
  if (channel === "color") {
    // Identifiers/references are bad for color
    if (isIdentifier || isReference) {
      return {
        message: "Not suitable for color",
        reason:
          "Unique IDs or references create too many distinct colors to be meaningful.",
      };
    }

    // Check if same as X or Y axis (redundant encoding)
    if (columnName === otherColumns?.x || columnName === otherColumns?.y) {
      return {
        message: "Already used on axis",
        reason:
          "This column is already encoded on an axis. Color works best with a different dimension to add information.",
      };
    }

    // High cardinality categorical is hard to distinguish
    if (
      (isCategorical || isBoolean) &&
      col.cardinality > CARDINALITY_THRESHOLDS.COLOR_MAX
    ) {
      return {
        message: "Too many categories",
        reason:
          "More than 12 distinct colors are hard to distinguish. Consider filtering or grouping.",
      };
    }

    // Numerical columns can work for gradients but may not be ideal
    if (isNumerical && !isTemporal) {
      // Only warn if it's clearly a measure (high cardinality)
      if (col.cardinality > 20) {
        return {
          message: "Consider a categorical column",
          reason:
            "Numerical measures work better on axes. Color is most effective with categories (2-12 values) for clear visual distinction.",
        };
      }
    }

    return null;
  }

  // 2. Size Encoding Logic (for scatter plots)
  if (channel === "size") {
    // Size needs numerical values
    if (!isNumerical) {
      return {
        message: "Numerical column recommended",
        reason:
          "Size encoding requires numerical values to map to point sizes.",
      };
    }

    // Check if same as X or Y
    if (columnName === otherColumns?.x || columnName === otherColumns?.y) {
      return {
        message: "Already used on axis",
        reason: "Using the same column for both axis and size is redundant.",
      };
    }

    return null;
  }

  // 3. General Axis Warnings (X and Y)

  // Warn if X and Y are the same column
  if (otherAxisColumn && columnName === otherAxisColumn) {
    return {
      message: "Same column on both axes",
      reason:
        "Comparing a column to itself usually doesn't show meaningful insights.",
    };
  }

  // Get other axis category for bar chart bidirectional logic
  const otherAxisCategory = getColumnCategory(otherAxisColumn, analysis);
  const axis = channel as "x" | "y";

  // 2. Bar Chart Logic (Bidirectional - can be vertical or horizontal)
  // Bar charts need one dimension (categorical/temporal) and one measure (numerical)
  if (chartType === "bar") {
    // Identifiers are never good for bar charts
    if (isIdentifier || isReference) {
      return {
        message: "Not suitable for bar charts",
        reason:
          "This column contains unique labels or IDs. Bar charts work best with categorical dimensions or numerical measures.",
      };
    }

    // If other axis is numerical (measure), this axis should be a dimension
    if (isMeasureCategory(otherAxisCategory)) {
      if (isNumerical) {
        return {
          message: "Consider a categorical column",
          reason:
            "The other axis already has a numerical measure. Bar charts need one dimension (categorical/temporal) and one measure (numerical).",
        };
      }
    }
    // If other axis is a dimension, this axis should be numerical (measure)
    else if (isDimensionCategory(otherAxisCategory)) {
      if (!isNumerical) {
        return {
          message: "Numerical column recommended",
          reason:
            "The other axis already has a categorical dimension. Bar charts need a numerical measure on the other axis.",
        };
      }
    }
    // If other axis is not set yet, give general guidance
    else if (!otherAxisColumn) {
      // High cardinality numerical on either axis is suspicious
      if (isNumerical && col.cardinality > 20) {
        return {
          message: "Many unique values",
          reason:
            "A numerical column with many values might be better suited for a Histogram or Scatter plot.",
        };
      }
    }

    return null;
  }

  // 3. Y-Axis Specific Logic for non-bar charts
  if (axis === "y") {
    // Identifiers and References are almost never good Y-axis candidates
    if (isIdentifier || isReference) {
      return {
        message: "Not a measurable value",
        reason:
          "This column contains unique labels or IDs, which cannot be aggregated (sum/avg) meaningfully.",
      };
    }

    // Line, Area, Scatter require a numerical Y-axis
    if (["line", "area", "scatter"].includes(chartType)) {
      if (!isNumerical) {
        return {
          message: "Numerical column recommended",
          reason: `${chartType.charAt(0).toUpperCase() + chartType.slice(1)} charts need numerical values on the Y-axis to show height, trends, or position.`,
        };
      }
    }
  }

  // 4. X-Axis Specific Logic for non-bar charts
  if (axis === "x") {
    // Scatter plots need numerical X-axis
    if (chartType === "scatter") {
      if (!isNumerical) {
        return {
          message: "Numerical column recommended",
          reason:
            "Scatter plots need numerical values on both axes to show correlations between two measures.",
        };
      }
    }

    // Line/Area charts prefer Temporal or Numerical (continuous)
    if (chartType === "line" || chartType === "area") {
      if (isCategorical && col.cardinality > 20) {
        return {
          message: "Too many categories",
          reason:
            "Line charts with many categories can look cluttered. Consider a Bar chart or filtering.",
        };
      }
      if (!isTemporal && !isNumerical && !isCategorical) {
        return {
          message: "Ordered column recommended",
          reason: "Line charts work best with time-series or continuous data.",
        };
      }
    }
  }

  return null;
}

/**
 * Create column options ranked by suitability with inline warning indicators.
 *
 * Scores each column based on how appropriate it is for the given axis and chart type,
 * then sorts them by score (best options first). Each option includes its warning if any.
 *
 * @param columns - Array of column names
 * @param axis - Which axis to rank for ("x" or "y")
 * @param chartType - The current visualization type
 * @param analysis - Column analysis data from analyzeDataFrame
 * @param otherAxisColumn - The column currently selected for the other axis
 * @returns Sorted array of column options with scores and warnings
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complex by design: ranks columns based on multiple heuristics and chart type
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

      const isNumerical = colAnalysis.category === "numerical";
      const isTemporal = colAnalysis.category === "temporal";
      const isCategorical = colAnalysis.category === "categorical";
      const isIdentifier =
        colAnalysis.category === "identifier" ||
        colAnalysis.category === "uuid";

      // Base Score
      let score = 50;

      // --- VERTICAL BAR CHART SCORING ---
      // For vertical bar charts: X = dimension (categorical/temporal), Y = metric
      if (chartType === "bar") {
        if (axis === "x") {
          // X axis needs categorical or temporal dimensions
          if (isCategorical) score += 100;
          if (isTemporal) score += 80;
          // Numerical dimensions are blocked by enforcer, but penalize if somehow present
          if (isNumerical) score -= 50;
        } else {
          // Y axis needs metrics (numerical aggregations)
          if (isNumerical) score += 100;
          if (!isNumerical) score -= 50;
        }
        if (isIdentifier) score -= 100;
      }

      // --- HORIZONTAL BAR CHART SCORING ---
      // For horizontal bar charts: X = metric, Y = dimension (categorical/temporal)
      else if (chartType === "barHorizontal") {
        if (axis === "x") {
          // X axis needs metrics (numerical aggregations)
          if (isNumerical) score += 100;
          if (!isNumerical) score -= 50;
        } else {
          // Y axis needs categorical or temporal dimensions
          if (isCategorical) score += 100;
          if (isTemporal) score += 80;
          // Numerical dimensions are blocked by enforcer, but penalize if somehow present
          if (isNumerical) score -= 50;
        }
        if (isIdentifier) score -= 100;
      }
      // --- Y-AXIS SCORING (non-bar charts) ---
      else if (axis === "y") {
        // Y-axis is almost always the "Measure" (Numerical)
        if (isNumerical) score += 100;

        // Penalize non-numericals heavily for standard charts
        if (!isNumerical && ["line", "area", "scatter"].includes(chartType)) {
          score -= 50;
        }

        // Identifiers are terrible Y-axis candidates
        if (isIdentifier) score -= 100;
      }
      // --- X-AXIS SCORING (non-bar) ---
      else if (axis === "x") {
        if (chartType === "line" || chartType === "area") {
          // Line charts love Time
          if (isTemporal) score += 100;
          if (isNumerical) score += 60; // Continuous X is good
          if (isCategorical) score += 20; // Categories ok if low cardinality
        } else if (chartType === "scatter") {
          // Scatter needs Numerical X
          if (isNumerical) score += 100;
          if (!isNumerical) score -= 50;
        }
      }

      // --- GENERAL PENALTIES ---

      // Severe penalty for using the same column on both axes
      if (otherAxisColumn && col === otherAxisColumn) {
        score -= 200;
      }

      // Penalty for existing warnings (ensure warned items drop to bottom)
      if (warning) {
        score -= 50;
      }

      return { label: col, value: col, score, warning: warning || undefined };
    })
    .sort((a, b) => b.score - a.score); // Sort by score descending
}
