/**
 * Field/Column Icon Utilities
 *
 * Provides icon mapping for data fields and columns based on their types.
 * Used in field selectors, axis configuration, and data model displays.
 */

import type { IconType } from "react-icons";
import { Hash, Calendar, Toggle, Type, Calculator } from "@dashframe/ui/icons";
import type { ColumnAnalysis, ColumnSemantic } from "@dashframe/types";

/**
 * Get icon for a field based on its type string.
 * Works with Field.type values from the schema.
 *
 * @param type - Field type string (e.g., "number", "date", "string")
 * @returns Icon component for the field type
 */
export function getFieldTypeIcon(type: string): IconType {
  const normalizedType = type.toLowerCase();

  // Numeric types
  if (
    ["number", "integer", "float", "decimal", "int", "bigint"].includes(
      normalizedType,
    )
  ) {
    return Hash;
  }

  // Date/time types
  if (
    ["date", "datetime", "timestamp", "time"].includes(normalizedType) ||
    normalizedType.includes("date")
  ) {
    return Calendar;
  }

  // Boolean types
  if (["boolean", "bool"].includes(normalizedType)) {
    return Toggle;
  }

  // Default to text/string
  return Type;
}

/**
 * Get icon for a column based on its ColumnAnalysis semantic.
 * Works with ColumnAnalysis.semantic values from DuckDB analysis.
 *
 * @param semantic - Column semantic from ColumnAnalysis
 * @returns Icon component for the column semantic
 */
export function getColumnCategoryIcon(semantic: ColumnSemantic): IconType {
  switch (semantic) {
    case "numerical":
      return Hash;
    case "temporal":
      return Calendar;
    case "boolean":
      return Toggle;
    case "categorical":
    case "identifier":
    case "reference":
    case "uuid":
    case "url":
    case "email":
    case "text":
    case "unknown":
    default:
      return Type;
  }
}

/**
 * Get icon for a column, with special handling for metrics (aggregations).
 * Metrics get a Calculator icon; dimensions get type-specific icons.
 *
 * @param columnName - Name of the column
 * @param columnAnalysis - Array of ColumnAnalysis from DuckDB
 * @param metricNames - Set of metric names (aggregations like "sum(revenue)")
 * @returns Icon component for the column
 */
export function getColumnIcon(
  columnName: string,
  columnAnalysis: ColumnAnalysis[],
  metricNames: Set<string>,
): IconType {
  // Metrics (aggregations) get Calculator icon
  if (metricNames.has(columnName)) {
    return Calculator;
  }

  // Find column analysis for type icon
  const col = columnAnalysis.find((c) => c.columnName === columnName);
  if (!col) return Type;

  return getColumnCategoryIcon(col.semantic);
}
