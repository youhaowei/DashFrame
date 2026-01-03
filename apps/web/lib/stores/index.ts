import "./config";

// ============================================================================
// UI Stores - Ephemeral UI state (not persisted)
// ============================================================================
export {
  useConfirmDialogStore,
  type ConfirmDialogConfig,
} from "./confirm-dialog-store";

// ============================================================================
// Type Exports
// ============================================================================
export type {
  BaseDataSource,
  DataSource,
  DataTable,
  Insight,
  InsightExecutionType,
  LocalDataSource,
  NotionDataSource,
  PostgreSQLDataSource,
  Visualization,
  VisualizationSource,
} from "./types";

export {
  isCSVDataSource,
  isLocalDataSource, // Legacy alias for isLocalDataSource
  isNotionDataSource,
  isPostgreSQLDataSource,
} from "./types";
