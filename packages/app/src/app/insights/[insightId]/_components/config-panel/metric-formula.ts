import type { AggregationType } from "@dashframe/types";

/**
 * Shared by the add and edit metric popovers so both build the same save
 * payload for Count.
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
