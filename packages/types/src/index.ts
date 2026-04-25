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

export type { AggregationType, InsightMetric, Metric } from "./metric";

export type {
  DataFrame,
  DataFrameData,
  DataFrameFactory,
  DataFrameJSON,
  DataFrameRow,
  DataFrameStorageLocation,
} from "./dataframe";

export type { DataTableField, DataTableInfo } from "./data-table-info";

// =============================================================================
// Repository Types
// =============================================================================

export type { UseQueryResult } from "./repository-base";

export type {
  CreateDataSourceInput,
  DataSource,
  DataSourceMutations,
  UseDataSourceMutations,
  UseDataSources,
  UseDataSourcesResult,
} from "./data-sources";

export type {
  DataTable,
  DataTableMutations,
  UseDataTableMutations,
  UseDataTables,
  UseDataTablesResult,
} from "./data-tables";

export type {
  CompiledInsight,
  Insight,
  InsightFilter,
  InsightJoinConfig,
  InsightMutations,
  InsightSort,
  UseInsightMutations,
  UseInsights,
} from "./insights";

export type {
  AxisType,
  ChartTag,
  ChartTypeMetadata,
  UseVisualizationMutations,
  UseVisualizations,
  UseVisualizationsResult,
  VegaLiteSpec,
  Visualization,
  VisualizationEncoding,
  VisualizationMutations,
  VisualizationType,
} from "./visualizations";

export {
  CHART_TAG_METADATA,
  CHART_TYPE_METADATA,
  SCATTER_MAX_POINTS,
  getAvailableTags,
  getChartTypesForTag,
  getTagsForChartType,
} from "./visualizations";

// =============================================================================
// Encoding Helpers
// =============================================================================

export type {
  CategoricalDateGroup,
  ChannelTransform,
  ChartEncoding,
  DateTransform,
  EncodingType,
  EncodingValue,
  FieldEncodingValue,
  MetricEncodingValue,
  ParsedEncoding,
  TemporalAggregation,
} from "./encoding-helpers";

export {
  fieldEncoding,
  isFieldEncoding,
  isMetricEncoding,
  isValidEncoding,
  metricEncoding,
  parseEncoding,
} from "./encoding-helpers";

export type {
  CreateItemInput,
  Dashboard,
  DashboardItem,
  DashboardItemType,
  DashboardMutations,
  UseDashboardMutations,
  UseDashboards,
  UseDashboardsResult,
} from "./dashboards";

// =============================================================================
// Column Analysis Types
// =============================================================================

export type {
  ArrayAnalysis,
  ArraySemantic,
  BooleanAnalysis,
  BooleanSemantic,
  ColumnAnalysis,
  ColumnAnalysisBase,
  ColumnCategory,
  ColumnDataType,
  ColumnSemantic,
  DataFrameAnalysis,
  DateAnalysis,
  DateSemantic,
  NumberAnalysis,
  NumberSemantic,
  StringAnalysis,
  StringSemantic,
  UnknownAnalysis,
  UnknownSemantic,
} from "./column-analysis";

export {
  CARDINALITY_THRESHOLDS,
  getLegacyCategory,
  looksLikeIdentifier,
} from "./column-analysis";
