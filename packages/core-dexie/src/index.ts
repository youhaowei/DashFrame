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
 * // Basic usage - import types from @dashframe/types, hooks from @dashframe/core
 * import type { DataSource } from '@dashframe/types';
 * import { useDataSources, useDataSourceMutations } from '@dashframe/core';
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
// Database Provider & Context
// ============================================================================

export { DatabaseProvider, useDatabase } from "./provider";

// ============================================================================
// Repository Implementations (Hooks)
// ============================================================================

// Data Sources
export {
  getAllDataSources,
  getDataSource,
  getDataSourceByType,
  useDataSourceMutations,
  useDataSources,
} from "./repositories/data-sources";

// Data Tables
export {
  getAllDataTables,
  getDataTable,
  getDataTablesBySource,
  useDataTableMutations,
  useDataTables,
} from "./repositories/data-tables";

// Insights
export {
  getAllInsights,
  getInsight,
  useCompiledInsight,
  useInsight,
  useInsightMutations,
  useInsights,
} from "./repositories/insights";

// Visualizations
export {
  getAllVisualizations,
  getVisualization,
  getVisualizationsByInsight,
  useVisualizationMutations,
  useVisualizations,
} from "./repositories/visualizations";

// Dashboards
export {
  getAllDashboards,
  getDashboard,
  useDashboardMutations,
  useDashboards,
} from "./repositories/dashboards";

// DataFrames
export {
  getAllDataFrames,
  getDataFrame,
  getDataFrameByInsight,
  getDataFrameEntry,
  useDataFrameMutations,
  useDataFrames,
  type DataFrameEntry,
  type DataFrameMutations,
  type UseDataFramesResult,
} from "./repositories/data-frames";

// ============================================================================
// Encryption Key Management
// ============================================================================

export {
  initializeEncryption,
  isEncryptionInitialized,
  isEncryptionUnlocked,
  lockEncryption,
  unlockEncryption,
} from "./crypto/key-manager";

export { migrateToEncryption } from "./crypto/migrate";

// ============================================================================
// Direct Database Access (advanced use cases only)
// ============================================================================

export { db } from "./db";
export type {
  DashboardEntity,
  DataFrameEntity,
  DataSourceEntity,
  DataTableEntity,
  InsightEntity,
  VisualizationEntity,
  SettingsEntity,
} from "./db";
