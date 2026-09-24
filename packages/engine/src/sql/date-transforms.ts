/**
 * Date Transform Utilities
 *
 * Provides SQL generation for date transforms.
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

import type { DateTransform } from "@dashframe/types";

import { quoteIdentifier } from "./quoting";

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
 * // Returns: "date_trunc('month', \"created_at\")"
 *
 * // Categorical grouping
 * applyDateTransformToSql('created_at', { kind: 'categorical', groupBy: 'monthName' })
 * // Returns: "monthname(\"created_at\")"
 * ```
 */
export function applyDateTransformToSql(
  columnName: string,
  transform: DateTransform,
): string {
  // Quote the identifier at the sink — guard holds regardless of provenance.
  const quotedColumn = quoteIdentifier(columnName);

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
