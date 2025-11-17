// DataFrame type definitions
export type ColumnType = "string" | "number" | "boolean" | "date" | "unknown";

export type DataFrameColumn = {
  name: string;
  type: ColumnType;
};

export type DataFrameRow = Record<string, unknown>;

export type DataFrame = {
  columns: DataFrameColumn[];
  rows: DataFrameRow[];
};

// UUID type for unique identifiers
// eslint-disable-next-line sonarjs/redundant-type-aliases
export type UUID = string;

// DataFrame source tracking (simplified)
export type DataFrameSource = {
  dataSourceId: UUID;
  insightId?: UUID; // Present for Notion insights, undefined for CSV
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

// Future DataFrame utilities will go here
// Examples:
// - DataFrame validation
// - DataFrame transformations
// - DataFrame serialization
// - Column operations
// - Row operations
// - Aggregation functions
