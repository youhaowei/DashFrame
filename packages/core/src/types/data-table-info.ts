import type { UUID } from "./uuid";

/**
 * Field metadata within a DataTable.
 * Used for UI display and query building.
 */
export interface DataTableField {
  id: UUID;
  name: string;
  columnName?: string;
  type?: string;
}

/**
 * DataTable metadata for UI and query configuration.
 * Represents a table's structure without the actual data.
 */
export interface DataTableInfo {
  id: UUID;
  name: string;
  dataFrameId?: UUID;
  fields: DataTableField[];
}
