import type { DataFrameColumn } from "./column";
import type { UUID } from "./uuid";

// ============================================================================
// DataFrame Storage Types (moved from @dashframe/engine)
// ============================================================================

/**
 * Storage location discriminated union.
 * Explicitly defines WHERE DataFrame data is stored.
 */
export type DataFrameStorageLocation =
  | { type: "indexeddb"; key: string }
  | { type: "file"; key: string }
  | { type: "s3"; bucket: string; key: string }
  | { type: "r2"; accountId: string; key: string };

/**
 * DataFrame JSON representation for persistence.
 * Contains only metadata needed to reconstruct the DataFrame.
 * Historical storage variants remain in this serialized contract so existing
 * Convex rows can still decode. New frames are always host file-backed.
 */
export interface DataFrameJSON {
  id: UUID;
  storage: DataFrameStorageLocation;
  fieldIds: UUID[];
  primaryKey?: string | string[];
  createdAt: number;
}

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
