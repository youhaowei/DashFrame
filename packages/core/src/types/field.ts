import type { ColumnType, TableColumn } from "./column";
import type { UUID } from "./uuid";

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
};

/**
 * Source schema wrapper - tracks schema version and sync time.
 */
export type SourceSchema = {
  columns: TableColumn[];
  version: number;
  lastSyncedAt: number;
};
