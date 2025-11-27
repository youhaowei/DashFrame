// DataFrame type definitions
export type ColumnType = "string" | "number" | "boolean" | "date" | "unknown";

export type DataFrameColumn = {
  name: string;
  type: ColumnType;
  sourceField?: string; // Original field name from source (e.g., "page.id" from Notion)
};

export type DataFrameRow = Record<string, unknown>;

export type DataFrame = {
  fieldIds: UUID[]; // References to Field definitions
  rows: DataFrameRow[];
  primaryKey?: string | string[]; // Column name(s) forming the primary key
  columns?: DataFrameColumn[];
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

// ============================================================================
// Field/Metric Architecture Types
// ============================================================================

// Foreign key reference (for join suggestions)
export type ForeignKey = {
  tableId: UUID; // Stable reference to target DataTable
  columnName: string; // Target column name
};

// Table column (discovered from source)
export type TableColumn = {
  name: string;
  type: string; // Native source type: "status", "relation", "varchar", "timestamp"
  foreignKey?: ForeignKey;
  isIdentifier?: boolean;
  isReference?: boolean;
};

// Field (user-facing column with lineage)
export type Field = {
  id: UUID;
  name: string; // User-facing name (can rename)
  tableId: UUID; // Which DataTable owns this field (lineage)
  columnName?: string; // Which TableColumn this maps to (undefined for computed fields)
  type: ColumnType; // Normalized: "string" | "number" | "date" | "boolean"
  isIdentifier?: boolean;
  isReference?: boolean;
};

// Metric (aggregation)
export type Metric = {
  id: UUID;
  name: string;
  tableId: UUID; // Which DataTable owns this metric (lineage)
  columnName?: string; // Which TableColumn to aggregate (undefined for count())
  aggregation: "sum" | "avg" | "count" | "min" | "max" | "count_distinct";
};

// Source schema wrapper
export type SourceSchema = {
  columns: TableColumn[];
  version: number;
  lastSyncedAt: number;
};

// DataFrame operations
export { join } from "./operations";
export type { JoinOptions, JoinType } from "./operations";

/**
 * @deprecated This function is deprecated with the new Field/Metric architecture.
 * DataFrame now uses fieldIds instead of columns.
 * This function will be removed in a future version.
 *
 * Ensure DataFrame has _rowIndex column and primaryKey set.
 * Used for migrating old DataFrames that were created before ID support.
 *
 * @param df - DataFrame to migrate
 * @returns Migrated DataFrame with _rowIndex and primaryKey
 */
export function ensureIdFields(df: any): any {
  // This function needs to be refactored for the new architecture
  // For now, just return the DataFrame as-is
  // TODO: Remove this function or update it to work with fieldIds
  return df;
}

// Future DataFrame utilities will go here
// Examples:
// - DataFrame validation
// - DataFrame serialization
// - Column operations
// - Row operations
// - Aggregation functions
export * from "./analyze";
