/**
 * Merge Analyses Helper for Joined Views
 *
 * When an insight joins multiple DataFrames, we need to combine their
 * cached column analyses. This avoids re-analyzing the entire joined view.
 *
 * Column names are already unique (UUID-based aliases like `field_<uuid>`),
 * so no prefix disambiguation is needed.
 */

import type { ColumnAnalysis, DataFrameAnalysis } from "@dashframe/types";

/**
 * Merge multiple DataFrameAnalysis results into a single ColumnAnalysis array.
 *
 * For joined views, each participating DataFrame has its own cached analysis.
 * This function combines them, using the first occurrence when column names
 * collide (which shouldn't happen with UUID-based naming).
 *
 * @param analyses - Array of DataFrameAnalysis from participating DataFrames
 * @returns Merged column analysis array
 *
 * @example
 * ```typescript
 * const baseAnalysis = baseDataFrame.analysis;
 * const joinedAnalysis = joinedDataFrame.analysis;
 *
 * if (baseAnalysis && joinedAnalysis) {
 *   const merged = mergeAnalyses([baseAnalysis, joinedAnalysis]);
 *   setColumnAnalysis(merged);
 * }
 * ```
 */
export function mergeAnalyses(analyses: DataFrameAnalysis[]): ColumnAnalysis[] {
  if (analyses.length === 0) return [];
  if (analyses.length === 1) return analyses[0].columns;

  // Track seen column names to avoid duplicates
  const seenColumns = new Set<string>();
  const merged: ColumnAnalysis[] = [];

  for (const analysis of analyses) {
    for (const col of analysis.columns) {
      // Skip if we've already added this column (first occurrence wins)
      if (seenColumns.has(col.columnName)) {
        console.debug(
          `[mergeAnalyses] Skipping duplicate column: ${col.columnName}`,
        );
        continue;
      }

      seenColumns.add(col.columnName);
      merged.push(col);
    }
  }

  return merged;
}

/**
 * Check if all analyses in a list are valid and have the expected field hash.
 *
 * @param analyses - Array of DataFrameAnalysis to validate
 * @param expectedFieldHashes - Map of DataFrame ID to expected field hash
 * @returns true if all analyses are valid and match their expected hashes
 */
export function areAnalysesValid(
  analyses: Array<{ id: string; analysis?: DataFrameAnalysis }>,
  expectedFieldHashes: Map<string, string>,
): boolean {
  for (const { id, analysis } of analyses) {
    if (!analysis) {
      console.debug(`[areAnalysesValid] Missing analysis for DataFrame ${id}`);
      return false;
    }

    const expectedHash = expectedFieldHashes.get(id);
    if (expectedHash && analysis.fieldHash !== expectedHash) {
      console.debug(
        `[areAnalysesValid] Field hash mismatch for DataFrame ${id}`,
        { expected: expectedHash, actual: analysis.fieldHash },
      );
      return false;
    }

    if (analysis.columns.length === 0) {
      console.debug(`[areAnalysesValid] Empty analysis for DataFrame ${id}`);
      return false;
    }
  }

  return true;
}
