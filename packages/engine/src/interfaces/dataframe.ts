import type { UUID } from "@dashframe/core";

/**
 * Storage location discriminated union.
 * Explicitly defines WHERE DataFrame data is stored.
 */
export type DataFrameStorageLocation =
  | { type: "indexeddb"; key: string }
  | { type: "s3"; bucket: string; key: string }
  | { type: "r2"; accountId: string; key: string };

/**
 * DataFrame serialization format.
 * Contains only metadata needed to reconstruct the DataFrame.
 */
export interface DataFrameSerialization {
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

  /**
   * Serialize DataFrame for storage.
   */
  toJSON(): DataFrameSerialization;

  /**
   * Get storage type for UI/display purposes.
   */
  getStorageType(): string;
}

/**
 * Factory function type for creating DataFrames.
 */
export type DataFrameFactory = {
  /**
   * Create DataFrame from Arrow buffer with automatic storage.
   */
  create(
    arrowBuffer: Uint8Array,
    fieldIds: UUID[],
    options?: {
      storageType?: "indexeddb" | "s3" | "r2";
      primaryKey?: string | string[];
    },
  ): Promise<DataFrame>;

  /**
   * Deserialize DataFrame from storage.
   */
  fromJSON(data: DataFrameSerialization): DataFrame;
};
