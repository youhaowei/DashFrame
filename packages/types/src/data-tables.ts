import type { Field, SourceSchema } from "./field";
import type { Metric } from "./metric";
import type { UUID } from "./uuid";

/** Provider-neutral shape persisted for a table materialized from a definition. */
export interface TableDefinition {
  dimensions: string[];
  metrics: string[];
  dateRange:
    | { kind: "relative"; months: number }
    | { kind: "absolute"; start: string; end: string };
  grain: "day" | "week" | "month";
  filters?: Array<
    | {
        kind: "dimension";
        field: string;
        operator: "exact" | "inList";
        values: string[];
      }
    | {
        kind: "metric";
        field: string;
        operator: "greaterThan";
        value: number;
      }
  >;
}

/** How a materialized table can be reproduced. */
export type TableOrigin =
  | { kind: "resource" }
  | {
      kind: "definition";
      version: 1;
      presetId?: string;
      definition: TableDefinition;
    };

export function tableOrigin(table: Pick<DataTable, "origin">): TableOrigin {
  return table.origin ?? { kind: "resource" };
}

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
  /** Opaque revision of external data or source-definition changes; Insight publications preserve it. */
  refreshRevision?: string;
  origin?: TableOrigin;
}
