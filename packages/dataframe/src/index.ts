// DataFrame type definitions
export type ColumnType = "string" | "number" | "boolean" | "date" | "unknown";

export type DataFrameColumn = {
  name: string;
  type: ColumnType;
  sourceField?: string; // Original field name from source (e.g., "page.id" from Notion)
};

export type DataFrameRow = Record<string, unknown>;

export type DataFrame = {
  columns: DataFrameColumn[];
  primaryKey?: string | string[]; // Column name(s) forming the primary key
  rows: DataFrameRow[];
};

// UUID type for unique identifiers
// eslint-disable-next-line sonarjs/redundant-type-aliases
export type UUID = string;

// DataFrame source tracking
// DataFrames are produced by Insights (which reference DataTables/DataSources)
export type DataFrameSource = {
  insightId?: UUID; // The Insight that produced this DataFrame (for transforms/queries)
  // For simple cases (direct CSV load), insightId may be undefined
};

// DataFrame metadata for tracking source and timestamp
export type DataFrameMetadata = {
  id: UUID;
  name: string;
  source: DataFrameSource;
  timestamp: number; // Unix timestamp in milliseconds
  rowCount: number;
  columnCount: number;
};

// Enhanced DataFrame with metadata
export type EnhancedDataFrame = {
  metadata: DataFrameMetadata;
  data: DataFrame;
};

// DataFrame operations
export { join } from "./operations";
export type { JoinOptions, JoinType } from "./operations";

/**
 * Ensure DataFrame has _rowIndex column and primaryKey set.
 * Used for migrating old DataFrames that were created before ID support.
 *
 * @param df - DataFrame to migrate
 * @returns Migrated DataFrame with _rowIndex and primaryKey
 */
export function ensureIdFields(df: DataFrame): DataFrame {
  // Check if already has _rowIndex column
  const hasRowIndex = df.columns.some((col) => col.name === "_rowIndex");

  if (hasRowIndex && df.primaryKey) {
    // Already migrated
    return df;
  }

  // Add _rowIndex column if missing
  const columns: DataFrameColumn[] = hasRowIndex
    ? df.columns
    : [
        { name: "_rowIndex", type: "number" },
        ...df.columns,
      ];

  // Add _rowIndex values to rows if missing
  const rows: DataFrameRow[] = hasRowIndex
    ? df.rows
    : df.rows.map((row, index) => ({
        _rowIndex: index,
        ...row,
      }));

  // Detect or set primary key
  let primaryKey = df.primaryKey;
  if (!primaryKey) {
    // Try to detect ID column by name pattern
    const idColumn = df.columns.find((col) => /^_?id$/i.test(col.name));
    primaryKey = idColumn ? idColumn.name : "_rowIndex";
  }

  return {
    columns,
    primaryKey,
    rows,
  };
}

// Future DataFrame utilities will go here
// Examples:
// - DataFrame validation
// - DataFrame serialization
// - Column operations
// - Row operations
// - Aggregation functions
