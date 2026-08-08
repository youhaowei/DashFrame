import type { AggregationType } from "@dashframe/types";

/**
 * Shared by the add and edit metric dialogs. Both render the same formula
 * preview and both build the same save payload, so the two must agree on what
 * a column means per aggregation — when they each carried their own copy, the
 * add path was fixed and the edit path silently kept the old behaviour.
 *
 * "Count (rows)" is `count(*)` by definition and neither dialog offers a column
 * picker for it, so any column still in state is invisible to the user.
 * Persisting it emits `count(column)`, which skips null rows — a different
 * number than the label promises. Use `count_distinct` to count values.
 */
export function metricColumnNameForSave(
  aggregation: AggregationType,
  columnName: string,
): string | undefined {
  if (aggregation === "count") return undefined;
  return columnName || undefined;
}

export function metricFormulaPreview(
  aggregation: AggregationType,
  columnName: string,
): string {
  if (aggregation === "count") {
    return "count(*)";
  }

  if (!columnName) {
    return `${aggregation}(?)`;
  }

  return `${aggregation}(${columnName})`;
}
