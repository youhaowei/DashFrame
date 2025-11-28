/**
 * Note: This file needs to be refactored for the new Field/Metric architecture.
 * The join operations currently use the deprecated `columns` property on DataFrame.
 * Future work should update joins to work with fieldIds and Field definitions.
 */
import type { DataFrame, DataFrameRow, DataFrameColumn } from "../index";

export type JoinType = "inner" | "left" | "right" | "outer";

export interface JoinOptions {
  on: { left: string; right: string } | string; // Join columns (string if same name in both)
  how?: JoinType; // Join type (default: "inner")
  suffixes?: { left: string; right: string }; // Suffixes for conflicting column names
}

/**
 * Coerce values for flexible join matching
 * Examples:
 * - String "123" matches number 123
 * - String "true" matches boolean true
 * - Date objects match ISO date strings
 * - null/undefined only match themselves
 */
function coerceValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  // Convert to string for comparison
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  // For dates stored as strings, normalize to ISO format
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return String(value);
}

/**
 * Check if two values match with type coercion
 */
function _valuesMatch(left: unknown, right: unknown): boolean {
  return coerceValue(left) === coerceValue(right);
}

/**
 * Join two DataFrames on specified columns with flexible type coercion
 */
export function join(
  left: DataFrame,
  right: DataFrame,
  options: JoinOptions,
): DataFrame {
  const {
    on,
    how = "inner",
    suffixes = { left: "_left", right: "_right" },
  } = options;

  // Determine join column names
  const leftJoinCol = typeof on === "string" ? on : on.left;
  const rightJoinCol = typeof on === "string" ? on : on.right;

  // Validate columns exist (required for join operations)
  if (!left.columns || !right.columns) {
    throw new Error("Join operations require DataFrames with columns property");
  }

  // Validate join columns exist
  if (!left.columns.find((col) => col.name === leftJoinCol)) {
    throw new Error(`Left join column "${leftJoinCol}" not found`);
  }
  if (!right.columns.find((col) => col.name === rightJoinCol)) {
    throw new Error(`Right join column "${rightJoinCol}" not found`);
  }

  // Build index for right DataFrame for efficient lookup
  const rightIndex = new Map<string | null, DataFrameRow[]>();
  right.rows.forEach((row) => {
    const key = coerceValue(row[rightJoinCol]);
    const existing = rightIndex.get(key) || [];
    existing.push(row);
    rightIndex.set(key, existing);
  });

  // Track which right rows were matched (for outer join)
  const matchedRightRows = new Set<DataFrameRow>();

  // Perform join
  const joinedRows: DataFrameRow[] = [];

  left.rows.forEach((leftRow) => {
    const leftKey = coerceValue(leftRow[leftJoinCol]);
    const rightMatches = rightIndex.get(leftKey) || [];

    if (rightMatches.length > 0) {
      // Match found - create joined rows
      rightMatches.forEach((rightRow) => {
        matchedRightRows.add(rightRow);
        joinedRows.push(mergeRows(leftRow, rightRow, left, right, suffixes));
      });
    } else if (how === "left" || how === "outer") {
      // No match - include left row with null right values
      joinedRows.push(mergeRows(leftRow, null, left, right, suffixes));
    }
  });

  // For right/outer join, add unmatched right rows
  if (how === "right" || how === "outer") {
    right.rows.forEach((rightRow) => {
      if (!matchedRightRows.has(rightRow)) {
        joinedRows.push(mergeRows(null, rightRow, left, right, suffixes));
      }
    });
  }

  // Build output columns
  const outputColumns = buildJoinedColumns(left, right, suffixes);

  // Determine primary key for joined DataFrame
  const outputPrimaryKey = determinePrimaryKey(left, right, how);

  return {
    fieldIds: [], // Note: fieldIds generation needed when refactoring for Field/Metric architecture
    columns: outputColumns,
    primaryKey: outputPrimaryKey,
    rows: joinedRows,
  };
}

/**
 * Merge two rows, handling null rows and column name conflicts
 */
function mergeRows(
  leftRow: DataFrameRow | null,
  rightRow: DataFrameRow | null,
  left: DataFrame,
  right: DataFrame,
  suffixes: { left: string; right: string },
): DataFrameRow {
  const merged: DataFrameRow = {};

  // Columns are guaranteed to exist at this point due to validation in join()
  const leftColumns = left.columns!;
  const rightColumns = right.columns!;

  // Add left columns
  if (leftRow) {
    leftColumns.forEach((col) => {
      const outputName = needsSuffix(col.name, rightColumns)
        ? `${col.name}${suffixes.left}`
        : col.name;
      merged[outputName] = leftRow[col.name];
    });
  } else {
    // Null row - fill with nulls
    leftColumns.forEach((col) => {
      const outputName = needsSuffix(col.name, rightColumns)
        ? `${col.name}${suffixes.left}`
        : col.name;
      merged[outputName] = null;
    });
  }

  // Add right columns
  if (rightRow) {
    rightColumns.forEach((col) => {
      const outputName = needsSuffix(col.name, leftColumns)
        ? `${col.name}${suffixes.right}`
        : col.name;
      merged[outputName] = rightRow[col.name];
    });
  } else {
    // Null row - fill with nulls
    rightColumns.forEach((col) => {
      const outputName = needsSuffix(col.name, leftColumns)
        ? `${col.name}${suffixes.right}`
        : col.name;
      merged[outputName] = null;
    });
  }

  return merged;
}

/**
 * Check if a column name conflicts with columns in the other DataFrame
 */
function needsSuffix(
  columnName: string,
  otherColumns: DataFrameColumn[],
): boolean {
  return otherColumns.some((col) => col.name === columnName);
}

/**
 * Build column definitions for joined DataFrame
 */
function buildJoinedColumns(
  left: DataFrame,
  right: DataFrame,
  suffixes: { left: string; right: string },
): DataFrameColumn[] {
  const columns: DataFrameColumn[] = [];

  // Columns are guaranteed to exist at this point due to validation in join()
  const leftColumns = left.columns!;
  const rightColumns = right.columns!;

  // Add left columns
  leftColumns.forEach((col) => {
    const outputName = needsSuffix(col.name, rightColumns)
      ? `${col.name}${suffixes.left}`
      : col.name;
    columns.push({
      ...col,
      name: outputName,
    });
  });

  // Add right columns
  rightColumns.forEach((col) => {
    const outputName = needsSuffix(col.name, leftColumns)
      ? `${col.name}${suffixes.right}`
      : col.name;
    columns.push({
      ...col,
      name: outputName,
    });
  });

  return columns;
}

/**
 * Determine primary key for joined DataFrame
 */
function determinePrimaryKey(
  left: DataFrame,
  right: DataFrame,
  how: JoinType,
): string | string[] | undefined {
  // For inner/left joins, use left's primary key if it exists
  if ((how === "inner" || how === "left") && left.primaryKey) {
    return left.primaryKey;
  }

  // For right joins, use right's primary key if it exists
  if (how === "right" && right.primaryKey) {
    return right.primaryKey;
  }

  // For outer joins or when no primary key exists, don't set one
  return undefined;
}
