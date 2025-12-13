import type { UUID } from "./uuid";

/**
 * Normalized column type for DashFrame.
 * All source types are mapped to one of these.
 */
export type ColumnType = "string" | "number" | "boolean" | "date" | "unknown";

/**
 * DataFrame column definition.
 */
export type DataFrameColumn = {
  name: string;
  type: ColumnType;
  /** Original field name from source (e.g., "page.id" from Notion) */
  sourceField?: string;
};

/**
 * Foreign key reference (for join suggestions).
 */
export type ForeignKey = {
  /** Stable reference to target DataTable */
  tableId: UUID;
  /** Target column name */
  columnName: string;
};

/**
 * Table column as discovered from source.
 * Preserves native source types before normalization.
 */
export type TableColumn = {
  name: string;
  /** Native source type: "status", "relation", "varchar", "timestamp" */
  type: string;
  foreignKey?: ForeignKey;
  isIdentifier?: boolean;
  isReference?: boolean;
};
