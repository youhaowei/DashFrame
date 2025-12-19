// =============================================================================
// Core Types
// =============================================================================

export type { UUID } from "./uuid";

export type {
  ColumnType,
  DataFrameColumn,
  ForeignKey,
  TableColumn,
} from "./column";

export type { Field, SourceSchema } from "./field";

export type { AggregationType, Metric, InsightMetric } from "./metric";

export type {
  DataFrameStorageLocation,
  DataFrameJSON,
  DataFrame,
  DataFrameFactory,
  DataFrameRow,
  DataFrameData,
} from "./dataframe";

export type { DataTableField, DataTableInfo } from "./data-table-info";

// =============================================================================
// Repository Types
// =============================================================================

export type { UseQueryResult } from "./repository-base";

export type {
  DataSource,
  CreateDataSourceInput,
  UseDataSourcesResult,
  DataSourceMutations,
  UseDataSources,
  UseDataSourceMutations,
} from "./data-sources";

export type {
  DataTable,
  UseDataTablesResult,
  DataTableMutations,
  UseDataTables,
  UseDataTableMutations,
} from "./data-tables";

export type {
  InsightFilter,
  InsightSort,
  InsightJoinConfig,
  Insight,
  CompiledInsight,
  InsightMutations,
  UseInsights,
  UseInsightMutations,
} from "./insights";

export type {
  VegaLiteSpec,
  VisualizationType,
  AxisType,
  VisualizationEncoding,
  Visualization,
  UseVisualizationsResult,
  VisualizationMutations,
  UseVisualizations,
  UseVisualizationMutations,
} from "./visualizations";

// =============================================================================
// Encoding Helpers
// =============================================================================

export type {
  FieldEncodingValue,
  MetricEncodingValue,
  EncodingValue,
  EncodingType,
  ParsedEncoding,
  ChartEncoding,
} from "./encoding-helpers";

export {
  parseEncoding,
  fieldEncoding,
  metricEncoding,
  isFieldEncoding,
  isMetricEncoding,
  isValidEncoding,
} from "./encoding-helpers";

export type {
  DashboardItemType,
  DashboardItem,
  Dashboard,
  UseDashboardsResult,
  CreateItemInput,
  DashboardMutations,
  UseDashboards,
  UseDashboardMutations,
} from "./dashboards";
