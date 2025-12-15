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
  // DataFrame interface types (storage references)
  DataFrameStorageLocation,
  DataFrameJSON,
  DataFrame,
  DataFrameFactory,
  // DataFrame data types (in-memory)
  DataFrameRow,
  DataFrameData,
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
  CreateDataSourceInput,
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
  VisualizationType,
  AxisType,
  VisualizationEncoding,
  Visualization,
  UseVisualizationsResult,
  VisualizationMutations,
  UseVisualizations,
  UseVisualizationMutations,
  // Dashboards
  DashboardItemType,
  DashboardItem,
  CreateItemInput,
  Dashboard,
  UseDashboardsResult,
  DashboardMutations,
  UseDashboards,
  UseDashboardMutations,
} from "./repositories";

// ============================================================================
// Chart Renderer Types
// ============================================================================

export type {
  ChartTheme,
  ChartConfig,
  ChartCleanup,
  ChartRenderer,
  ChartRendererRegistry,
} from "./chart-renderers";
