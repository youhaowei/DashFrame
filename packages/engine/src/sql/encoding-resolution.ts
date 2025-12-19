/**
 * Encoding Resolution Helpers
 *
 * This module provides helpers to resolve encoding values (`field:<uuid>` or `metric:<uuid>`)
 * to their concrete values for different contexts:
 *
 * - `resolveToSql`: For rendering - returns SQL expressions (e.g., "category", "sum(revenue)")
 * - `resolveForAnalysis`: For validation - returns column info for ColumnAnalysis lookup
 *
 * No legacy format support - invalid formats return undefined or { valid: false }.
 */

import type { Field, InsightMetric } from "@dashframe/types";
import { parseEncoding } from "@dashframe/types";
import { metricToSqlExpression } from "./insight-sql";

// ============================================================================
// Resolution Context
// ============================================================================

/**
 * Context needed to resolve encoding values.
 * Contains all fields and metrics available in the current insight.
 */
export interface EncodingResolutionContext {
  /** Available fields from base table and joined tables */
  fields: Field[];
  /** Available metrics defined on the insight */
  metrics: InsightMetric[];
}

// ============================================================================
// Resolution for Rendering (SQL expressions)
// ============================================================================

/**
 * Resolve an encoding string to a SQL expression for chart rendering.
 * Returns undefined for invalid encoding formats or missing references.
 *
 * @param value - Encoding string (e.g., "field:abc-123" or "metric:xyz-456")
 * @param context - Resolution context with fields and metrics
 * @returns SQL expression (column name or aggregation) or undefined
 *
 * @example
 * ```typescript
 * // Field encoding resolves to column name
 * resolveToSql("field:abc-123", context)
 * // Returns: "category" (the field's columnName)
 *
 * // Metric encoding resolves to SQL aggregation
 * resolveToSql("metric:xyz-456", context)
 * // Returns: "sum(revenue)"
 *
 * // Invalid format returns undefined
 * resolveToSql("sum(revenue)", context)
 * // Returns: undefined
 * ```
 */
export function resolveToSql(
  value: string | undefined,
  context: EncodingResolutionContext,
): string | undefined {
  const parsed = parseEncoding(value);
  if (!parsed) return undefined; // Invalid format

  switch (parsed.type) {
    case "field": {
      const field = context.fields.find((f) => f.id === parsed.id);
      return field ? (field.columnName ?? field.name) : undefined;
    }
    case "metric": {
      const metric = context.metrics.find((m) => m.id === parsed.id);
      return metric ? metricToSqlExpression(metric) : undefined;
    }
  }
}

// ============================================================================
// Resolution for Analysis/Validation
// ============================================================================

/**
 * Result of resolving an encoding for analysis/validation purposes.
 */
export interface ResolvedForAnalysis {
  /**
   * Column name for ColumnAnalysis lookup.
   * Undefined for count(*) metrics (no underlying column) or missing references.
   */
  columnName?: string;
  /** True if this is a metric (aggregation) */
  isMetric: boolean;
  /** Full SQL expression for metrics */
  sqlExpression?: string;
  /** Whether the encoding format was valid (field: or metric: prefix) */
  valid: boolean;
}

/**
 * Resolve an encoding for validation against ColumnAnalysis.
 * Returns { valid: false } for invalid encoding formats.
 *
 * Key behaviors:
 * - Invalid formats (missing prefix) return { valid: false, isMetric: false }
 * - Missing field/metric references return { valid: true, isMetric: ..., columnName: undefined }
 * - count(*) metrics return { valid: true, isMetric: true, columnName: undefined }
 *
 * @param value - Encoding string
 * @param context - Resolution context with fields and metrics
 * @returns Resolution result with validity, column info, and metric flag
 *
 * @example
 * ```typescript
 * // Field encoding
 * resolveForAnalysis("field:abc-123", context)
 * // Returns: { columnName: "category", isMetric: false, valid: true }
 *
 * // Metric encoding
 * resolveForAnalysis("metric:xyz-456", context)
 * // Returns: { columnName: "revenue", isMetric: true, sqlExpression: "sum(revenue)", valid: true }
 *
 * // count(*) metric
 * resolveForAnalysis("metric:count-all", context)
 * // Returns: { columnName: undefined, isMetric: true, sqlExpression: "count(*)", valid: true }
 *
 * // Invalid format
 * resolveForAnalysis("sum(revenue)", context)
 * // Returns: { isMetric: false, valid: false }
 * ```
 */
export function resolveForAnalysis(
  value: string | undefined,
  context: EncodingResolutionContext,
): ResolvedForAnalysis {
  const parsed = parseEncoding(value);
  if (!parsed) {
    // Invalid format - no legacy support
    return { isMetric: false, valid: false };
  }

  switch (parsed.type) {
    case "field": {
      const field = context.fields.find((f) => f.id === parsed.id);
      return {
        columnName: field ? (field.columnName ?? field.name) : undefined,
        isMetric: false,
        valid: true,
      };
    }
    case "metric": {
      const metric = context.metrics.find((m) => m.id === parsed.id);
      return {
        columnName: metric?.columnName, // May be undefined for count(*)
        isMetric: true,
        sqlExpression: metric ? metricToSqlExpression(metric) : undefined,
        valid: true,
      };
    }
  }
}

// ============================================================================
// Batch Resolution for Rendering
// ============================================================================

/**
 * Resolved encoding for rendering purposes.
 * Maps encoding channels to their SQL expressions.
 */
export interface ResolvedEncoding {
  x?: string;
  y?: string;
  color?: string;
  size?: string;
}

/**
 * Resolve all encoding channels to SQL expressions for rendering.
 * Invalid or missing encodings result in undefined values.
 *
 * @param encoding - Visualization encoding with channel mappings
 * @param context - Resolution context with fields and metrics
 * @returns Resolved encoding with SQL expressions
 *
 * @example
 * ```typescript
 * resolveEncodingToSql({
 *   x: "field:category-id",
 *   y: "metric:sum-revenue-id",
 *   color: "field:region-id"
 * }, context)
 * // Returns: { x: "category", y: "sum(revenue)", color: "region" }
 * ```
 */
export function resolveEncodingToSql(
  encoding: {
    x?: string;
    y?: string;
    color?: string;
    size?: string;
  },
  context: EncodingResolutionContext,
): ResolvedEncoding {
  return {
    x: resolveToSql(encoding.x, context),
    y: resolveToSql(encoding.y, context),
    color: resolveToSql(encoding.color, context),
    size: resolveToSql(encoding.size, context),
  };
}
