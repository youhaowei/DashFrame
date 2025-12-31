import "./config";

// ============================================================================
// UI Stores - Ephemeral UI state (not persisted)
// ============================================================================
export {
  useConfirmDialogStore,
  type ConfirmDialogConfig,
} from "./confirm-dialog-store";

export {
  useToastStore,
  type ToastConfig,
  type ToastType,
} from "./toast-store";

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
