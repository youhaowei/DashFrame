import type { UUID } from "./uuid";
import type { DataFrameColumn } from "./column";

/**
 * DataFrameRow - A single row of data as a key-value record.
 */
export type DataFrameRow = Record<string, unknown>;

/**
 * DataFrameData - Plain object representation of DataFrame content.
 *
 * Used for in-memory data storage in stores and UI components.
 * Contains actual row data (unlike DataFrame class which is a reference).
 */
export type DataFrameData = {
  fieldIds: UUID[];
  columns?: DataFrameColumn[];
  rows: DataFrameRow[];
};

/**
 * DataFrameSource - Tracks where a DataFrame came from.
 */
export type DataFrameSource = {
  /** The Insight that produced this DataFrame (for transforms/queries) */
  insightId?: UUID;
  // For simple cases (direct CSV load), insightId may be undefined
};

/**
 * DataFrameMetadata - Metadata about a DataFrame.
 */
export type DataFrameMetadata = {
  id: UUID;
  name: string;
  source: DataFrameSource;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  rowCount: number;
  columnCount: number;
};

/**
 * EnhancedDataFrame - DataFrame with attached metadata.
 *
 * Note: Uses DataFrameData (plain object with rows)
 * NOT DataFrame class (reference to storage).
 */
export type EnhancedDataFrame = {
  metadata: DataFrameMetadata;
  data: DataFrameData;
};
