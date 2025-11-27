import type { UUID, Field, Metric, SourceSchema } from "@dashframe/dataframe";
import type { TopLevelSpec } from "vega-lite";

// ============================================================================
// DataTables (raw table data from sources)
// ============================================================================

// DataTable behavior varies by source type:
// - Local (CSV): Contains loaded data → has dataFrameId
// - Cached (Notion): Config + cached data → has dataFrameId (can refresh)
// - Remote (PostgreSQL): Metadata only → no dataFrameId (needs Insight query to fetch)
export interface DataTable {
  id: UUID;
  name: string; // User-defined display name
  dataSourceId: UUID; // Which DataSource this belongs to (renamed from sourceId)
  table: string; // Notion DB ID, CSV filename, PostgreSQL table name, etc.

  // Schema layers
  sourceSchema?: SourceSchema; // Discovered columns from source
  fields: Field[]; // User-defined columns (auto-generated initially)
  metrics: Metric[]; // Aggregations (includes default count())

  // Data reference
  dataFrameId?: UUID; // Present for local/cached, absent for remote metadata-only tables

  // Timestamps
  lastFetchedAt?: number; // Timestamp of last data fetch (for cached sources like Notion)
  createdAt: number;
}

// ============================================================================
// Insights (unified abstraction for analytic questions)
// ============================================================================

// Two execution strategies:
// - 'transform': Local/cloud processing on DataFrames (CSV, Notion cached data)
// - 'query': Remote processing at data source (PostgreSQL, data lakes)
/** @deprecated Use baseTable structure instead */
export type InsightExecutionType = "transform" | "query";

// Insight-level metric definition (computed column)
export interface InsightMetric {
  id: UUID;
  name: string;
  sourceTable: UUID; // Which table (base or joined) - for v1, always baseTable.tableId
  columnName?: string; // Which column to aggregate (undefined for count())
  aggregation: "sum" | "avg" | "count" | "min" | "max" | "count_distinct";
}

export interface Insight {
  id: UUID;
  name: string;

  // Table structure - v1: single base table
  baseTable: {
    tableId: UUID;
    selectedFields: UUID[]; // Which fields to include (references Field.id)
  };

  // v2: Multi-table support (reserved for future)
  joins?: Array<{
    id: UUID;
    tableId: UUID;
    selectedFields: UUID[];
    joinOn: { baseField: UUID; joinedField: UUID };
    joinType: "inner" | "left" | "right" | "outer";
  }>;

  // Computed columns
  metrics: InsightMetric[];

  // Filtering and sorting
  filters?: {
    excludeNulls?: boolean; // Remove null values before aggregation
    limit?: number; // Top N groups (applied after aggregation)
    orderBy?: {
      fieldOrMetricId: UUID; // Which field or metric to sort by
      direction: "asc" | "desc";
    };
  };

  // Forking (for visualization-specific insight copies)
  forkedFrom?: UUID; // If this insight was forked from another, track the original

  // Output cache
  dataFrameId?: UUID; // Aggregated/computed DataFrame for visualizations
  lastComputedAt?: number;

  createdAt: number;
  updatedAt: number;

  // ===== Legacy fields (backward compatibility) =====
  /** @deprecated Use baseTable.tableId instead. Array kept for old multi-table insights. */
  dataTableIds?: UUID[];
  /** @deprecated Execution type is now inferred from source type */
  executionType?: InsightExecutionType;
  /** @deprecated Use baseTable/joins/metrics instead */
  config?: unknown;
}

// ============================================================================
// Data Sources (Symmetric Structure - All sources have DataTables)
// ============================================================================

// Base interface for all data sources
// All sources contain DataTables Map for consistency
export interface BaseDataSource {
  id: UUID;
  type: "local" | "notion" | "postgresql";
  name: string;
  dataTables: Map<UUID, DataTable>; // All sources have DataTables (consistent)
  createdAt: number;
}

// Local Data Source - browser storage (CSV uploads, local files)
export interface LocalDataSource extends BaseDataSource {
  type: "local";
  // No credentials needed - data stored in browser
  // Each uploaded CSV file becomes a DataTable
}

// Notion Data Source - Notion workspace connection
export interface NotionDataSource extends BaseDataSource {
  type: "notion";
  apiKey: string; // Integration token
  // Each Notion database becomes a DataTable
}

// PostgreSQL Data Source - database connection (future)
export interface PostgreSQLDataSource extends BaseDataSource {
  type: "postgresql";
  connectionString: string; // Connection credential
  // Each PostgreSQL table becomes a DataTable
}

// Union type for all data sources
export type DataSource =
  | LocalDataSource
  | NotionDataSource
  | PostgreSQLDataSource;

// Type guards
export const isLocalDataSource = (ds: DataSource): ds is LocalDataSource =>
  ds.type === "local";

export const isNotionDataSource = (ds: DataSource): ds is NotionDataSource =>
  ds.type === "notion";

export const isPostgreSQLDataSource = (
  ds: DataSource,
): ds is PostgreSQLDataSource => ds.type === "postgresql";

// Legacy type guard for backward compatibility (Local sources used to be CSV sources)
export const isCSVDataSource = (ds: DataSource): ds is LocalDataSource =>
  ds.type === "local";

// ============================================================================
// Visualizations
// ============================================================================

export type VisualizationType = "table" | "bar" | "line" | "scatter" | "area";

export type AxisType = "quantitative" | "nominal" | "ordinal" | "temporal";

export interface VisualizationEncoding {
  x?: string;
  y?: string;
  xType?: AxisType;
  yType?: AxisType;
  color?: string;
  size?: string;
}

export interface VisualizationSource {
  dataFrameId: UUID; // The DataFrame being visualized
  insightId?: UUID; // The Insight that produced it (for refresh/provenance tracking)
}

export interface Visualization {
  id: UUID;
  name: string;
  source: VisualizationSource;
  spec: Omit<TopLevelSpec, "data">; // Vega-Lite spec (data comes from DataFrame)
  visualizationType: VisualizationType; // Display type (table/chart)
  encoding?: VisualizationEncoding; // Column mappings for chart types
  createdAt: number;
}
