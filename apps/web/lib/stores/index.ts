import "./config";

// Re-export all stores
export { useDataSourcesStore } from "./data-sources-store";
export { useDataFramesStore } from "./dataframes-store";
export { useVisualizationsStore } from "./visualizations-store";
export { useInsightsStore } from "./insights-store";

// Re-export all types
export type {
  DataTable,
  Insight,
  InsightExecutionType,
  BaseDataSource,
  LocalDataSource,
  NotionDataSource,
  PostgreSQLDataSource,
  DataSource,
  VisualizationSource,
  Visualization,
} from "./types";

export {
  isLocalDataSource,
  isCSVDataSource, // Legacy alias for isLocalDataSource
  isNotionDataSource,
  isPostgreSQLDataSource,
} from "./types";
