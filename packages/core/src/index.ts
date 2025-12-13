/**
 * @dashframe/core
 *
 * Core types and repository interfaces for DashFrame.
 * This package has ZERO runtime dependencies.
 *
 * Types are pure data definitions used throughout the system.
 * Repository interfaces define the contract for persistence implementations
 * (e.g., @dashframe/core-dexie, @dashframe/core-convex).
 */

// ============================================================================
// Core Types
// ============================================================================

export type {
  // UUID
  UUID,
  // Column types
  ColumnType,
  DataFrameColumn,
  ForeignKey,
  TableColumn,
  // Field types
  Field,
  SourceSchema,
  // Metric types
  AggregationType,
  Metric,
  InsightMetric,
  // DataFrame types
  DataFrameRow,
  DataFrameData,
  DataFrameSource,
  DataFrameMetadata,
  EnhancedDataFrame,
  // DataTable metadata types
  DataTableField,
  DataTableInfo,
} from "./types";

// ============================================================================
// Repository Interfaces
// ============================================================================

export type {
  // Common
  UseQueryResult,
  // Data Sources
  DataSource,
  LocalDataSource,
  NotionDataSource,
  UseDataSourcesResult,
  DataSourceMutations,
  UseDataSources,
  UseDataSourceMutations,
  // Data Tables
  DataTable,
  UseDataTablesResult,
  DataTableMutations,
  UseDataTables,
  UseDataTableMutations,
  // Insights
  InsightStatus,
  InsightFilter,
  InsightSort,
  InsightJoinConfig,
  Insight,
  UseInsightsResult,
  InsightMutations,
  UseInsights,
  UseInsightMutations,
  // Visualizations
  VegaLiteSpec,
  Visualization,
  UseVisualizationsResult,
  VisualizationMutations,
  UseVisualizations,
  UseVisualizationMutations,
  // Dashboards
  DashboardPanel,
  Dashboard,
  UseDashboardsResult,
  DashboardMutations,
  UseDashboards,
  UseDashboardMutations,
} from "./repositories";

// Type guards
export { isLocalDataSource, isNotionDataSource } from "./repositories";
