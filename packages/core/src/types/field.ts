import type { ColumnType, TableColumn } from "./column";
import type { UUID } from "./uuid";

// Re-export sensitivity types and helpers from @dashframe/types — single
// source of truth; no duplicate implementations in this package.
export {
  buildSensitivityUpdate,
  getFieldSensitivity,
  isFieldRestricted,
} from "@dashframe/types";
export type {
  FieldSensitivity,
  FieldSensitivitySource,
} from "@dashframe/types";

import type {
  FieldSensitivity,
  FieldSensitivitySource,
} from "@dashframe/types";

/**
 * Field - User-facing column with lineage tracking.
 *
 * Fields are derived from TableColumns but have:
 * - User-editable names
 * - Normalized types
 * - Lineage back to source table
 */
export type Field = {
  id: UUID;
  /** User-facing name (can be renamed) */
  name: string;
  /** Which DataTable owns this field (lineage) */
  tableId: UUID;
  /** Which TableColumn this maps to (undefined for computed fields) */
  columnName?: string;
  /** Normalized type: "string" | "number" | "date" | "boolean" */
  type: ColumnType;
  isIdentifier?: boolean;
  isReference?: boolean;
  /**
   * Privacy axis — single source of truth read by every privacy gate
   * (cache-write, artifact-DB, egress) and by engine placement.
   * Absent means `unclassified`, which is restricted (fail-closed).
   * Distinct from the semantic axis (`isIdentifier`/`isReference`).
   */
  sensitivity?: FieldSensitivity;
  /** Why the current sensitivity value was set — keeps marking legible */
  sensitivityReason?: string;
  /** Who set the current sensitivity value */
  sensitivitySource?: FieldSensitivitySource;
};

/**
 * Source schema wrapper - tracks schema version and sync time.
 */
export type SourceSchema = {
  columns: TableColumn[];
  version: number;
  lastSyncedAt: number;
};
