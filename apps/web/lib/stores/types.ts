import type { UUID } from "@dash-frame/dataframe";
import type { TopLevelSpec } from "vega-lite";

// ============================================================================
// Insights (generic query configuration)
// ============================================================================

export interface Insight {
  id: UUID;
  name: string;
  table: string; // Which table/database to query (e.g., Notion database ID)
  dimensions: string[]; // Which columns/properties to select
  // Future: filters, sorts, aggregations
  createdAt: number;
}

// ============================================================================
// Data Sources
// ============================================================================

// Base interface for all data sources
export interface BaseDataSource {
  id: UUID;
  name: string;
  createdAt: number;
  insights?: Map<UUID, Insight>; // Future: filtered views, aggregations
}

// Data Entity - has DataFrame, can be visualized directly
export interface DataEntity extends BaseDataSource {
  dataFrameId: UUID;
}

// Data Connection - requires insights to generate DataFrames
export interface DataConnection extends BaseDataSource {
  dataFrameId: null;
  insights: Map<UUID, Insight>;
}

// CSV Data Source - has direct data, can optionally add insights
export interface CSVDataSource extends DataEntity {
  type: "csv";
  fileName: string;
  fileSize: number;
  uploadedAt: number;
}

// Notion Data Source - pure connection, requires insights
export interface NotionDataSource extends DataConnection {
  type: "notion";
  apiKey: string; // Connection credential
}

// Union type for all data sources
export type DataSource = CSVDataSource | NotionDataSource;

// Type guards
export const isCSVDataSource = (ds: DataSource): ds is CSVDataSource =>
  ds.type === "csv";

export const isNotionDataSource = (ds: DataSource): ds is NotionDataSource =>
  ds.type === "notion";

// Check if DataSource has direct data (implements DataEntity)
export const isDataEntity = (ds: DataSource): ds is CSVDataSource =>
  ds.dataFrameId !== null;

// Check if DataSource is a connection (implements DataConnection)
export const isDataConnection = (ds: DataSource): ds is NotionDataSource =>
  ds.dataFrameId === null;

// ============================================================================
// Visualizations
// ============================================================================

export interface VisualizationSource {
  dataFrameId: UUID;
  // If from Notion insight, these are set for refresh capability
  dataSourceId?: UUID;
  insightId?: UUID;
}

export interface Visualization {
  id: UUID;
  name: string;
  source: VisualizationSource;
  spec: Omit<TopLevelSpec, "data">; // Vega-Lite spec (data comes from DataFrame)
  createdAt: number;
}
