import type { UUID } from "./uuid";
import type { DataFrameColumn } from "./column";

// ============================================================================
// DataFrame Storage Types
// ============================================================================

/**
 * Storage location discriminated union.
 * Explicitly defines WHERE DataFrame data is stored.
 */
export type DataFrameStorageLocation =
  | { type: "indexeddb"; key: string }
  | { type: "s3"; bucket: string; key: string }
  | { type: "r2"; accountId: string; key: string };

/**
 * DataFrame JSON representation for persistence.
 * Contains only metadata needed to reconstruct the DataFrame.
 * This is the return type of DataFrame.toJSON().
 */
export interface DataFrameJSON {
  id: UUID;
  storage: DataFrameStorageLocation;
  fieldIds: UUID[];
  primaryKey?: string | string[];
  createdAt: number;
}

/**
 * DataFrame interface - Lightweight reference with explicit storage location.
 *
 * This interface represents a dataset but does NOT contain the actual data.
 * Instead, it knows WHERE to find the data and provides methods to access it.
 *
 * Implementations:
 * - BrowserDataFrame (engine-browser) - DuckDB-WASM + IndexedDB
 * - ServerDataFrame (engine-server) - DuckDB native + PostgreSQL
 */
export interface DataFrame {
  readonly id: UUID;
  readonly storage: DataFrameStorageLocation;
  readonly fieldIds: UUID[];
  readonly primaryKey?: string | string[];
  readonly createdAt: number;

  /** Serialize DataFrame for storage. */
  toJSON(): DataFrameJSON;

  /** Get storage type for UI/display purposes. */
  getStorageType(): string;
}

/**
 * Factory function type for creating DataFrames.
 */
export type DataFrameFactory = {
  /** Create DataFrame from Arrow buffer with automatic storage. */
  create(
    arrowBuffer: Uint8Array,
    fieldIds: UUID[],
    options?: {
      storageType?: "indexeddb" | "s3" | "r2";
      primaryKey?: string | string[];
    },
  ): Promise<DataFrame>;

  /** Deserialize DataFrame from storage. */
  fromJSON(data: DataFrameJSON): DataFrame;
};

// ============================================================================
// DataFrame Data Types (in-memory representations)
// ============================================================================

/**
 * DataFrameRow - A single row of data as a key-value record.
 */
export type DataFrameRow = Record<string, unknown>;

/**
 * DataFrameData - Plain object representation of DataFrame content.
 *
 * Used for in-memory data processing and UI display.
 * Contains actual row data (unlike DataFrame class which is a storage reference).
 *
 * The `columns` field is optional - can be derived from row keys or provided
 * explicitly when type information is needed.
 */
export type DataFrameData = {
  rows: DataFrameRow[];
  columns?: DataFrameColumn[];
};
