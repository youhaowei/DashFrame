/**
 * Migration utilities for migrating from localStorage (Zustand) to Dexie (IndexedDB).
 *
 * This module handles the one-time migration of existing DashFrame data from
 * the old Zustand + superjson localStorage persistence to the new Dexie-based
 * IndexedDB storage.
 */

import superjson from "superjson";
import { db } from "../db";
import type {
  DataSourceEntity,
  DataTableEntity,
  InsightEntity,
  VisualizationEntity,
  DashboardEntity,
} from "../db";

// ============================================================================
// Constants
// ============================================================================

const MIGRATION_KEY = "dashframe:migrated-to-dexie";

// localStorage keys from old Zustand stores
const STORAGE_KEYS = {
  dataSources: "dashframe:data-sources",
  insights: "dashframe:insights",
  visualizations: "dashframe:visualizations",
  dashboards: "dashframe:dashboards",
} as const;

// ============================================================================
// Types for old localStorage format
// ============================================================================

/**
 * Legacy DataTable stored nested inside DataSource
 */
interface LegacyDataTable {
  id: string;
  name: string;
  dataSourceId: string;
  table: string;
  sourceSchema?: unknown;
  fields: unknown[];
  metrics: unknown[];
  dataFrameId?: string;
  createdAt: number;
  lastFetchedAt?: number;
}

/**
 * Legacy DataSource with nested dataTables Map
 */
interface LegacyDataSource {
  id: string;
  type: "local" | "notion";
  name: string;
  apiKey?: string;
  dataTables: Map<string, LegacyDataTable>;
  createdAt: number;
}

/**
 * Legacy Insight format
 */
interface LegacyInsight {
  id: string;
  name: string;
  baseTableId: string;
  selectedFields: string[];
  metrics: unknown[];
  filters?: unknown[];
  sorts?: unknown[];
  joins?: unknown[];
  status: string;
  error?: string;
  dataFrameId?: string;
  createdAt: number;
  updatedAt?: number;
}

/**
 * Legacy Visualization format
 */
interface LegacyVisualization {
  id: string;
  name: string;
  source: { insightId: string };
  spec: unknown;
  visualizationType?: string;
  encoding?: unknown;
  isActive?: boolean;
  createdAt: number;
  updatedAt?: number;
}

/**
 * Legacy Dashboard format
 */
interface LegacyDashboard {
  id: string;
  name: string;
  description?: string;
  items: Array<{
    id: string;
    visualizationId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  createdAt: number;
  updatedAt?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse superjson-serialized data from localStorage
 */
function parseSuperjsonStorage<T>(raw: string | null): T | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);

    // Zustand persist format wraps state in { state: {...}, version: number }
    const stateWrapper = parsed?.state;
    if (!stateWrapper) return null;

    // Check for superjson format
    if (
      stateWrapper &&
      typeof stateWrapper === "object" &&
      "json" in stateWrapper &&
      "meta" in stateWrapper
    ) {
      return superjson.deserialize(stateWrapper) as T;
    }

    return stateWrapper as T;
  } catch (error) {
    console.error("Failed to parse localStorage data:", error);
    return null;
  }
}

// ============================================================================
// Migration Functions
// ============================================================================

/**
 * Check if migration has already been performed
 */
export function isMigrationComplete(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(MIGRATION_KEY) === "true";
}

/**
 * Mark migration as complete
 */
function markMigrationComplete(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MIGRATION_KEY, "true");
}

/**
 * Migrate data sources and data tables from localStorage to Dexie.
 * Key transformation: Flatten nested dataTables Map → separate dataTables table
 */
async function migrateDataSources(): Promise<void> {
  const raw = localStorage.getItem(STORAGE_KEYS.dataSources);
  const data = parseSuperjsonStorage<{
    dataSources: Map<string, LegacyDataSource>;
  }>(raw);

  if (!data?.dataSources) return;

  for (const [, source] of data.dataSources) {
    // Insert data source (without nested dataTables)
    const dataSourceEntity: DataSourceEntity = {
      id: source.id,
      type: source.type,
      name: source.name,
      apiKey: source.type === "notion" ? source.apiKey : undefined,
      createdAt: source.createdAt,
    };

    await db.dataSources.put(dataSourceEntity);

    // Flatten nested dataTables Map to separate table
    if (source.dataTables) {
      for (const [, table] of source.dataTables) {
        const dataTableEntity: DataTableEntity = {
          id: table.id,
          dataSourceId: source.id,
          name: table.name,
          table: table.table,
          sourceSchema: table.sourceSchema as DataTableEntity["sourceSchema"],
          fields: table.fields as DataTableEntity["fields"],
          metrics: table.metrics as DataTableEntity["metrics"],
          dataFrameId: table.dataFrameId,
          createdAt: table.createdAt,
          lastFetchedAt: table.lastFetchedAt,
        };

        await db.dataTables.put(dataTableEntity);
      }
    }
  }
}

/**
 * Migrate insights from localStorage to Dexie
 */
async function migrateInsights(): Promise<void> {
  const raw = localStorage.getItem(STORAGE_KEYS.insights);
  const data = parseSuperjsonStorage<{ insights: Map<string, LegacyInsight> }>(
    raw,
  );

  if (!data?.insights) return;

  for (const [, insight] of data.insights) {
    const insightEntity: InsightEntity = {
      id: insight.id,
      name: insight.name,
      baseTableId: insight.baseTableId,
      selectedFields: insight.selectedFields,
      metrics: insight.metrics as InsightEntity["metrics"],
      filters: insight.filters as InsightEntity["filters"],
      sorts: insight.sorts as InsightEntity["sorts"],
      joins: insight.joins as InsightEntity["joins"],
      status: insight.status as InsightEntity["status"],
      error: insight.error,
      dataFrameId: insight.dataFrameId,
      createdAt: insight.createdAt,
      updatedAt: insight.updatedAt,
    };

    await db.insights.put(insightEntity);
  }
}

/**
 * Migrate visualizations from localStorage to Dexie
 */
async function migrateVisualizations(): Promise<void> {
  const raw = localStorage.getItem(STORAGE_KEYS.visualizations);
  const data = parseSuperjsonStorage<{
    visualizations: Map<string, LegacyVisualization>;
  }>(raw);

  if (!data?.visualizations) return;

  for (const [, viz] of data.visualizations) {
    const vizEntity: VisualizationEntity = {
      id: viz.id,
      name: viz.name,
      insightId: viz.source.insightId,
      spec: viz.spec as VisualizationEntity["spec"],
      isActive: viz.isActive ?? false,
      createdAt: viz.createdAt,
      updatedAt: viz.updatedAt,
    };

    await db.visualizations.put(vizEntity);
  }
}

/**
 * Migrate dashboards from localStorage to Dexie
 */
async function migrateDashboards(): Promise<void> {
  const raw = localStorage.getItem(STORAGE_KEYS.dashboards);
  const data = parseSuperjsonStorage<{
    dashboards: Map<string, LegacyDashboard>;
  }>(raw);

  if (!data?.dashboards) return;

  for (const [, dashboard] of data.dashboards) {
    const dashboardEntity: DashboardEntity = {
      id: dashboard.id,
      name: dashboard.name,
      description: dashboard.description,
      panels: dashboard.items.map((item) => ({
        id: item.id,
        visualizationId: item.visualizationId,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
      })),
      createdAt: dashboard.createdAt,
      updatedAt: dashboard.updatedAt,
    };

    await db.dashboards.put(dashboardEntity);
  }
}

// ============================================================================
// Main Migration Function
// ============================================================================

/**
 * Perform full migration from localStorage to Dexie.
 *
 * This function:
 * 1. Checks if migration already completed
 * 2. Migrates all data from localStorage (superjson) to IndexedDB (Dexie)
 * 3. Flattens nested structures (dataTables from DataSource)
 * 4. Marks migration as complete
 *
 * Safe to call multiple times - will skip if already migrated.
 */
export async function migrateFromLocalStorage(): Promise<void> {
  // Skip if already migrated or running on server
  if (typeof window === "undefined") return;
  if (isMigrationComplete()) return;

  console.log("[DashFrame] Starting migration from localStorage to Dexie...");

  try {
    // Run all migrations in a transaction for atomicity
    await db.transaction(
      "rw",
      [
        db.dataSources,
        db.dataTables,
        db.insights,
        db.visualizations,
        db.dashboards,
      ],
      async () => {
        await migrateDataSources();
        await migrateInsights();
        await migrateVisualizations();
        await migrateDashboards();
      },
    );

    markMigrationComplete();
    console.log("[DashFrame] Migration completed successfully.");
  } catch (error) {
    console.error("[DashFrame] Migration failed:", error);
    throw error;
  }
}

/**
 * Reset migration state (for development/testing only).
 * This allows re-running the migration by clearing the migration flag
 * and all Dexie data.
 */
export async function resetMigration(): Promise<void> {
  if (typeof window === "undefined") return;

  localStorage.removeItem(MIGRATION_KEY);
  await db.dataSources.clear();
  await db.dataTables.clear();
  await db.insights.clear();
  await db.visualizations.clear();
  await db.dashboards.clear();

  console.log(
    "[DashFrame] Migration state reset. Re-run migration to restore data.",
  );
}
