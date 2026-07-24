import type { Field, SourceSchema } from "./field";
import type { Metric } from "./metric";
import type { UUID } from "./uuid";

// ============================================================================
// DataTable Type
// ============================================================================

/**
 * DataTable - A table within a data source.
 *
 * Represents a specific table/collection from a data source:
 * - For local: A single CSV file
 * - For Notion: A single Notion database
 */
export interface DataTable {
  id: UUID;
  name: string;
  /** Parent data source ID */
  dataSourceId: UUID;
  /** Source table identifier (file name, database ID, etc.) */
  table: string;
  /** Discovered schema from source */
  sourceSchema?: SourceSchema;
  /** User-defined fields */
  fields: Field[];
  /** User-defined metrics */
  metrics: Metric[];
  /** ID of the associated DataFrame (if loaded) */
  dataFrameId?: UUID;
  createdAt: number;
  /** Last time data was fetched */
  lastFetchedAt?: number;
}
