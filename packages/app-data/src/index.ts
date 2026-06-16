/**
 * @dashframe/app-data
 *
 * WyStack implementation of the app's data-hook surface. Re-exports the exact
 * hook names and shapes the components import from `@dashframe/core`,
 * backed by the WyStack client (HTTP + WS live-invalidation).
 * `@dashframe/core` re-exports from here, so components stay
 * backend-agnostic and untouched.
 *
 * The host wires the runtime seam once at startup:
 *   - render `<Provider>` (from `createWyStack`) above the app, and
 *   - call `setWyStackClient(instance.client)` before rendering, so the
 *     imperative getters can reach the live client.
 */

// Runtime client seam (host wires this once).
export { getWyStackClient, setWyStackClient } from "./client";
export {
  createWyStackRuntime,
  resolveWyStackConfig,
  type WyStackRuntime,
  type WyStackRuntimeConfig,
} from "./runtime";

// Dashboards
export {
  getAllDashboards,
  getDashboard,
  useDashboardMutations,
  useDashboards,
} from "./dashboards";

export {
  addDataSource,
  getAllDataSources,
  getDataSource,
  getDataSourceByType,
  getOrCreateDataSourceByType,
  removeDataSource,
  updateDataSource,
  useDataSourceMutations,
  useDataSources,
} from "./data-sources";

export {
  addDataTable,
  createDataTable,
  getAllDataTables,
  getDataTable,
  getDataTablesBySource,
  updateDataTable,
  useDataTableMutations,
  useDataTables,
} from "./data-tables";

export {
  getAllInsights,
  getInsight,
  useCompiledInsight,
  useInsight,
  useInsightMutations,
  useInsights,
} from "./insights";

export {
  getAllVisualizations,
  getVisualization,
  getVisualizationsByInsight,
  useVisualizationMutations,
  useVisualizations,
} from "./visualizations";

export {
  addDataFrameEntry,
  clearAllData,
  getAllDataFrames,
  getDataFrame,
  getDataFrameByInsight,
  getDataFrameEntry,
  removeDataFrame,
  replaceDataFrame,
  updateDataFrameAnalysis,
  updateDataFrameEntry,
  updateMetadata,
  useDataFrameMutations,
  useDataFrames,
  type DataFrameEntry,
  type DataFrameMutations,
  type UseDataFramesResult,
} from "./data-frames";

export {
  listNotionDatabases,
  useNotionMutations,
  type NotionDatabaseRef,
  type NotionQueryResult,
} from "./notion";

export { DatabaseProvider, useDatabase } from "./compat";

// Preview batch — SPLIT-TIER: returns metadata only, no row data over the wire.
export {
  previewBatch,
  setPreviewAuthToken,
  type PreviewCommand,
} from "./preview-diff";
