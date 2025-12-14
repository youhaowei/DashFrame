/**
 * @dashframe/core-dexie
 *
 * Dexie (IndexedDB) persistence implementation for DashFrame.
 *
 * This package provides:
 * - Reactive hooks for reading data (useLiveQuery-based)
 * - Mutation functions for CRUD operations
 * - DatabaseProvider for app initialization
 *
 * @example
 * ```tsx
 * // Basic usage - import types and implementations together
 * import {
 *   useDataSources,
 *   useDataSourceMutations,
 *   type DataSource,
 * } from '@dashframe/core-dexie';
 *
 * function DataSourcesList() {
 *   const { data: sources, isLoading } = useDataSources();
 *   const { add, remove } = useDataSourceMutations();
 *
 *   if (isLoading) return <Loading />;
 *
 *   return (
 *     <ul>
 *       {sources?.map(source => (
 *         <li key={source.id}>{source.name}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // App initialization with DatabaseProvider
 * import { DatabaseProvider } from '@dashframe/core-dexie';
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <DatabaseProvider>
 *       {children}
 *     </DatabaseProvider>
 *   );
 * }
 * ```
 */

// ============================================================================
// Re-export all types from @dashframe/core
// This allows consumers to import types and implementations from a single package
// ============================================================================

export * from "@dashframe/core";

// ============================================================================
// Database Provider & Context
// ============================================================================

export { DatabaseProvider, useDatabase } from "./provider";

// ============================================================================
// Repository Implementations (Hooks)
// ============================================================================

// Data Sources
export {
  useDataSources,
  useDataSourceMutations,
  getDataSource,
  getDataSourceByType,
  getAllDataSources,
} from "./repositories/data-sources";

// Data Tables
export {
  useDataTables,
  useDataTableMutations,
  getDataTable,
  getDataTablesBySource,
  getAllDataTables,
} from "./repositories/data-tables";

// Insights
export {
  useInsights,
  useInsightMutations,
  getInsight,
  getAllInsights,
} from "./repositories/insights";

// Visualizations
export {
  useVisualizations,
  useVisualizationMutations,
  getVisualization,
  getVisualizationsByInsight,
  getAllVisualizations,
} from "./repositories/visualizations";

// Dashboards
export {
  useDashboards,
  useDashboardMutations,
  getDashboard,
  getAllDashboards,
} from "./repositories/dashboards";

// DataFrames
export {
  useDataFrames,
  useDataFrameMutations,
  getDataFrame,
  getDataFrameEntry,
  getDataFrameByInsight,
  getAllDataFrames,
  type DataFrameEntry,
  type UseDataFramesResult,
  type DataFrameMutations,
} from "./repositories/data-frames";

// ============================================================================
// Direct Database Access (advanced use cases only)
// ============================================================================

export { db } from "./db";
export type {
  DataSourceEntity,
  DataTableEntity,
  InsightEntity,
  VisualizationEntity,
  DashboardEntity,
  DataFrameEntity,
} from "./db";
