/**
 * Encoding Helpers for Visualization Channel Mappings
 *
 * This module provides strict types and parsing helpers for visualization encodings.
 * Encodings use prefixed string IDs as the canonical format:
 * - `field:<uuid>` for dimension fields
 * - `metric:<uuid>` for metric aggregations
 *
 * This approach ensures encodings remain stable when users rename metrics or fields,
 * since the underlying IDs don't change.
 */

import type { UUID } from "./uuid";

// ============================================================================
// Strict Encoding Types (compile-time validation)
// ============================================================================

/**
 * Encoding value for a dimension field.
 * Format: `field:<uuid>`
 */
export type FieldEncodingValue = `field:${UUID}`;

/**
 * Encoding value for a metric aggregation.
 * Format: `metric:<uuid>`
 */
export type MetricEncodingValue = `metric:${UUID}`;

/**
 * Valid encoding value - either a field or metric reference.
 * TypeScript will reject invalid strings like `"sum(amount)"` at compile time.
 */
export type EncodingValue = FieldEncodingValue | MetricEncodingValue;

// ============================================================================
// Encoding Value Parsing
// ============================================================================

/**
 * Type of encoding reference.
 */
export type EncodingType = "field" | "metric";

/**
 * Parsed encoding with type and ID extracted.
 */
export interface ParsedEncoding {
  type: EncodingType;
  id: UUID;
}

/**
 * Parse an encoding string into its type and ID components.
 * Returns undefined for invalid formats (no legacy support).
 *
 * @param value - Encoding string (e.g., "field:abc-123" or "metric:xyz-456")
 * @returns Parsed encoding or undefined if format is invalid
 *
 * @example
 * ```typescript
 * parseEncoding("field:abc-123")
 * // Returns: { type: "field", id: "abc-123" }
 *
 * parseEncoding("metric:xyz-456")
 * // Returns: { type: "metric", id: "xyz-456" }
 *
 * parseEncoding("sum(revenue)")  // Legacy format
 * // Returns: undefined
 * ```
 */
export function parseEncoding(
  value: string | undefined,
): ParsedEncoding | undefined {
  if (!value) return undefined;

  if (value.startsWith("field:")) {
    return { type: "field", id: value.slice(6) as UUID };
  }
  if (value.startsWith("metric:")) {
    return { type: "metric", id: value.slice(7) as UUID };
  }

  // Invalid format - no legacy support
  return undefined;
}

// ============================================================================
// Encoding Value Constructors
// ============================================================================

/**
 * Create a field encoding string from a field ID.
 *
 * @param id - Field UUID
 * @returns Field encoding value (e.g., "field:abc-123")
 */
export function fieldEncoding(id: UUID): FieldEncodingValue {
  return `field:${id}`;
}

/**
 * Create a metric encoding string from a metric ID.
 *
 * @param id - Metric UUID
 * @returns Metric encoding value (e.g., "metric:abc-123")
 */
export function metricEncoding(id: UUID): MetricEncodingValue {
  return `metric:${id}`;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for field encoding values.
 *
 * @param value - String to check
 * @returns True if value is a valid field encoding
 */
export function isFieldEncoding(
  value: string | undefined,
): value is FieldEncodingValue {
  return value?.startsWith("field:") ?? false;
}

/**
 * Type guard for metric encoding values.
 *
 * @param value - String to check
 * @returns True if value is a valid metric encoding
 */
export function isMetricEncoding(
  value: string | undefined,
): value is MetricEncodingValue {
  return value?.startsWith("metric:") ?? false;
}

/**
 * Type guard for valid encoding values (field or metric).
 *
 * @param value - String to check
 * @returns True if value is a valid encoding (either field or metric)
 */
export function isValidEncoding(
  value: string | undefined,
): value is EncodingValue {
  return isFieldEncoding(value) || isMetricEncoding(value);
}

// ============================================================================
// Date Transform Types
// ============================================================================

/**
 * Temporal aggregation - reduces data points while preserving time continuity.
 * Uses DuckDB's `date_trunc()` function to group dates.
 *
 * - `none`: No aggregation, use raw timestamps
 * - `yearWeek`: Group by week (date_trunc('week', col))
 * - `yearMonth`: Group by month (date_trunc('month', col))
 * - `year`: Group by year (date_trunc('year', col))
 *
 * Output is still a timestamp, so x-axis remains temporal (continuous time flow).
 */
export type TemporalAggregation = "none" | "yearWeek" | "yearMonth" | "year";

/**
 * Categorical date grouping - extracts period names for seasonal analysis.
 * Groups data across all years by the extracted period.
 *
 * - `monthName`: Extract month name (monthname(col) → "January", "February", ...)
 * - `dayOfWeek`: Extract day name (dayname(col) → "Monday", "Tuesday", ...)
 * - `quarter`: Extract quarter number (quarter(col) → 1, 2, 3, 4)
 *
 * Output is categorical, so x-axis becomes ordinal (discrete categories).
 */
export type CategoricalDateGroup = "monthName" | "dayOfWeek" | "quarter";

/**
 * Date transform configuration.
 * Discriminated union that determines how date columns are transformed.
 *
 * @example Temporal aggregation (monthly time series)
 * ```typescript
 * const transform: DateTransform = {
 *   kind: 'temporal',
 *   aggregation: 'yearMonth'
 * };
 * // SQL: date_trunc('month', created_at)
 * // Output: 2024-01-01, 2024-02-01, ...
 * // X-axis: temporal (continuous)
 * ```
 *
 * @example Categorical grouping (compare months across years)
 * ```typescript
 * const transform: DateTransform = {
 *   kind: 'categorical',
 *   groupBy: 'monthName'
 * };
 * // SQL: monthname(created_at)
 * // Output: "January", "February", ...
 * // X-axis: ordinal (discrete)
 * ```
 */
export type DateTransform =
  | { kind: "temporal"; aggregation: TemporalAggregation }
  | { kind: "categorical"; groupBy: CategoricalDateGroup };

/**
 * Channel transform configuration for encoding channels (x, y).
 * Currently supports date transforms; extensible for future transform types.
 */
export interface ChannelTransform {
  type: "date";
  transform: DateTransform;
}

// ============================================================================
// Chart Encoding (Rendering Format)
// ============================================================================

/**
 * Axis type for chart encoding.
 */
export type AxisType = "quantitative" | "nominal" | "ordinal" | "temporal";

/**
 * Chart encoding for rendering - uses plain strings (column names or SQL expressions).
 *
 * This is the format the vgplot renderer expects:
 * - Column names: "category", "revenue"
 * - SQL aggregations: "sum(revenue)", "avg(price)"
 * - Date functions: "dateMonth(created)"
 *
 * Use `resolveEncodingToChart` to convert from `VisualizationEncoding` (ID-based) to this format.
 */
export interface ChartEncoding {
  x?: string;
  y?: string;
  xType?: AxisType;
  yType?: AxisType;
  color?: string;
  size?: string;

  /**
   * Human-readable axis labels for display in chart UI.
   * These are the field/metric names shown on axes, legends, and tooltips.
   *
   * When set, the renderer should use these labels instead of the column names
   * (which may be UUID-based for consistency).
   */
  xLabel?: string;
  yLabel?: string;
  colorLabel?: string;
  sizeLabel?: string;

  /**
   * Date transform applied to X-axis (when X is temporal).
   * Used by renderer to determine interval for rectY marks.
   */
  xTransform?: ChannelTransform;
  /**
   * Date transform applied to Y-axis (when Y is temporal).
   * Used by renderer to determine interval for rectX marks.
   */
  yTransform?: ChannelTransform;
}
