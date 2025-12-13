import type { UUID, Field, Metric, SourceSchema } from "../types";
import type { UseQueryResult } from "./types";

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

// ============================================================================
// Repository Hook Types
// ============================================================================

/**
 * Result type for useDataTables hook.
 */
export type UseDataTablesResult = UseQueryResult<DataTable[]>;

/**
 * Mutation methods for data tables.
 */
export interface DataTableMutations {
  /** Add a new data table to a data source */
  add: (
    dataSourceId: UUID,
    name: string,
    table: string,
    options?: {
      id?: UUID;
      sourceSchema?: SourceSchema;
      fields?: Field[];
      metrics?: Metric[];
      dataFrameId?: UUID;
    },
  ) => Promise<UUID>;

  /** Update a data table */
  update: (
    id: UUID,
    updates: Partial<Omit<DataTable, "id" | "createdAt" | "dataSourceId">>,
  ) => Promise<void>;

  /** Refresh a data table with new DataFrame */
  refresh: (id: UUID, dataFrameId: UUID) => Promise<void>;

  /** Remove a data table */
  remove: (id: UUID) => Promise<void>;

  /** Add a field to a data table */
  addField: (dataTableId: UUID, field: Field) => Promise<void>;

  /** Update a field */
  updateField: (
    dataTableId: UUID,
    fieldId: UUID,
    updates: Partial<Field>,
  ) => Promise<void>;

  /** Delete a field */
  deleteField: (dataTableId: UUID, fieldId: UUID) => Promise<void>;

  /** Add a metric */
  addMetric: (dataTableId: UUID, metric: Metric) => Promise<void>;

  /** Update a metric */
  updateMetric: (
    dataTableId: UUID,
    metricId: UUID,
    updates: Partial<Metric>,
  ) => Promise<void>;

  /** Delete a metric */
  deleteMetric: (dataTableId: UUID, metricId: UUID) => Promise<void>;

  /** Update source schema */
  updateSourceSchema: (
    dataTableId: UUID,
    sourceSchema: SourceSchema,
  ) => Promise<void>;
}

/**
 * Hook type for reading data tables.
 */
export type UseDataTables = (dataSourceId?: UUID) => UseDataTablesResult;

/**
 * Hook type for data table mutations.
 */
export type UseDataTableMutations = () => DataTableMutations;
