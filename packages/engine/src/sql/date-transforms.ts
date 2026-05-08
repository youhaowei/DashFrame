/**
 * Date Transform Utilities
 *
 * Provides auto-selection of temporal aggregation based on data range,
 * and SQL generation for date transforms.
 *
 * ## Temporal Aggregation vs Categorical Transforms
 *
 * This module distinguishes between two types of date transforms:
 *
 * **Temporal Aggregation** (preserves time continuity):
 * - Uses `date_trunc()` to group by year/month/week
 * - Output is still a timestamp (e.g., 2024-01-01)
 * - X-axis remains temporal (continuous time flow)
 * - Use for: time series charts, trends over time
 *
 * **Categorical Grouping** (seasonal analysis):
 * - Uses `monthname()`, `dayname()`, `quarter()` to extract period names
 * - Output is categorical (e.g., "January", "Monday", 1)
 * - X-axis becomes ordinal (discrete categories)
 * - Use for: comparing Januaries across years, day-of-week patterns
 */

import type {
  AxisType,
  DateTransform,
  TemporalAggregation,
} from "@dashframe/types";

// ============================================================================
// Auto-Selection Algorithm
// ============================================================================

/**
 * Select optimal temporal aggregation based on data range.
 *
 * Goal: ~20-100 data points for readable charts.
 * This ensures the chart is neither too sparse nor too crowded.
 *
 * Thresholds:
 * - < 14 days: none (raw daily data, ~14 points max)
 * - 14 days - 6 months: yearWeek (~2-26 weeks)
 * - 6 months - 5 years: yearMonth (~6-60 months)
 * - > 5 years: year (manageable annual points)
 *
 * @param minDate - Minimum timestamp in milliseconds (from ColumnAnalysis)
 * @param maxDate - Maximum timestamp in milliseconds (from ColumnAnalysis)
 * @returns Recommended temporal aggregation level
 *
 * @example
 * ```typescript
 * // 3-month dataset → weekly aggregation
 * const agg = selectTemporalAggregation(
 *   Date.parse('2024-01-01'),
 *   Date.parse('2024-04-01')
 * );
 * // Returns: 'yearWeek'
 * ```
 */
export function selectTemporalAggregation(
  minDate: number | undefined,
  maxDate: number | undefined,
): TemporalAggregation {
  // Default to monthly if we don't have date range info
  if (minDate == null || maxDate == null) return "yearMonth";

  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const rangeDays = (maxDate - minDate) / MS_PER_DAY;

  // < 14 days: show raw data
  if (rangeDays < 14) return "none";

  // 14 days - 6 months (~180 days): weekly aggregation
  if (rangeDays < 180) return "yearWeek";

  // 6 months - 5 years (~1825 days): monthly aggregation
  if (rangeDays < 1825) return "yearMonth";

  // > 5 years: yearly aggregation
  return "year";
}

// ============================================================================
// SQL Generation
// ============================================================================

/**
 * Convert a DateTransform to DuckDB SQL expression.
 *
 * @param columnName - Column name or expression to transform
 * @param transform - Date transform configuration
 * @returns SQL expression string
 *
 * @example
 * ```typescript
 * // Temporal aggregation
 * applyDateTransformToSql('created_at', { kind: 'temporal', aggregation: 'yearMonth' })
 * // Returns: "date_trunc('month', created_at)"
 *
 * // Categorical grouping
 * applyDateTransformToSql('created_at', { kind: 'categorical', groupBy: 'monthName' })
 * // Returns: "monthname(created_at)"
 * ```
 */
export function applyDateTransformToSql(
  columnName: string,
  transform: DateTransform,
): string {
  // Ensure column name is quoted if needed
  const quotedColumn = columnName.startsWith('"')
    ? columnName
    : `"${columnName}"`;

  if (transform.kind === "temporal") {
    switch (transform.aggregation) {
      case "none":
        return quotedColumn;
      case "year":
        return `date_trunc('year', ${quotedColumn})`;
      case "yearMonth":
        return `date_trunc('month', ${quotedColumn})`;
      case "yearWeek":
        return `date_trunc('week', ${quotedColumn})`;
    }
  } else {
    // Categorical grouping
    switch (transform.groupBy) {
      case "monthName":
        return `monthname(${quotedColumn})`;
      case "dayOfWeek":
        return `dayname(${quotedColumn})`;
      case "quarter":
        return `quarter(${quotedColumn})`;
    }
  }
}

/**
 * Get the appropriate axis type for a date transform.
 *
 * Temporal aggregations keep the axis as 'temporal' (continuous time),
 * while categorical groupings convert to 'ordinal' (discrete categories).
 *
 * @param transform - Date transform configuration
 * @returns Axis type for vgplot encoding
 */
export function getAxisTypeForTransform(transform: DateTransform): AxisType {
  return transform.kind === "temporal" ? "temporal" : "ordinal";
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a temporal aggregation transform.
 *
 * @param aggregation - Temporal aggregation level
 * @returns DateTransform configuration
 */
export function temporalTransform(
  aggregation: TemporalAggregation,
): DateTransform {
  return { kind: "temporal", aggregation };
}

/**
 * Create a categorical date transform.
 *
 * @param groupBy - Categorical grouping type
 * @returns DateTransform configuration
 */
export function categoricalTransform(
  groupBy: "monthName" | "dayOfWeek" | "quarter",
): DateTransform {
  return { kind: "categorical", groupBy };
}

/**
 * Get human-readable label for a date transform.
 * Useful for UI display.
 *
 * @param transform - Date transform configuration
 * @returns Human-readable label
 */
export function getDateTransformLabel(transform: DateTransform): string {
  if (transform.kind === "temporal") {
    switch (transform.aggregation) {
      case "none":
        return "Raw dates";
      case "yearWeek":
        return "Weekly";
      case "yearMonth":
        return "Monthly";
      case "year":
        return "Yearly";
    }
  } else {
    switch (transform.groupBy) {
      case "monthName":
        return "By month name";
      case "dayOfWeek":
        return "By day of week";
      case "quarter":
        return "By quarter";
    }
  }
}
