import type { UUID } from "@dash-frame/dataframe";
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
  name: string;
  sourceId: UUID; // Which DataSource this belongs to
  table: string; // Notion DB ID, CSV filename, PostgreSQL table name, etc.
  dimensions: string[]; // Selected columns/fields to include
  dataFrameId?: UUID; // Present for local/cached, absent for remote metadata-only tables
  lastFetchedAt?: number; // Timestamp of last data fetch (for cached sources like Notion)
  createdAt: number;
}

// ============================================================================
// Insights (unified abstraction for analytic questions)
// ============================================================================

// Two execution strategies:
// - 'transform': Local/cloud processing on DataFrames (CSV, Notion cached data)
// - 'query': Remote processing at data source (PostgreSQL, data lakes)
export type InsightExecutionType = "transform" | "query";

export interface Insight {
  id: UUID;
  name: string;
  dataTableIds: UUID[]; // Can reference multiple tables from different sources
  executionType: InsightExecutionType;
  config?: unknown; // TransformConfig | QueryConfig - SQL, filters, joins, aggregations
  dataFrameId?: UUID; // Resulting DataFrame after execution
  createdAt: number;
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

export interface VisualizationEncoding {
  x?: string;
  y?: string;
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
