import "./config";

// ============================================================================
// Active Stores - Used with Convex for client-side data caching
// ============================================================================
export { useDataFramesStore } from "./dataframes-store";

// ============================================================================
// Legacy Stores - Being migrated to Convex
// These stores are kept for backward compatibility with components that
// haven't been migrated yet (e.g., JoinFlowModal, legacy workbench components)
// TODO: Remove once all components are migrated to Convex
// ============================================================================
export { useDataSourcesStore } from "./data-sources-store";
export { useVisualizationsStore } from "./visualizations-store";
export { useInsightsStore } from "./insights-store";

// ============================================================================
// Type Exports
// ============================================================================
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
