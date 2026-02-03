import type {
  DataFrameAnalysis,
  DataFrameJSON,
  Field,
  InsightMetric,
  Metric,
  SourceSchema,
  UUID,
  VegaLiteSpec,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";
import Dexie, { type EntityTable } from "dexie";

// ============================================================================
// Database Entity Types (Flat Tables)
// ============================================================================

/**
 * DataSource entity - stored as flat record.
 * Type is the connector ID from the registry (e.g., "csv", "notion").
 */
export interface DataSourceEntity {
  id: UUID;
  type: string; // Connector ID from registry (e.g., "csv", "notion")
  name: string;
  // Connector-specific fields (optional based on connector type)
  apiKey?: string; // For remote API connectors (e.g., Notion)
  connectionString?: string; // For database connectors (future)
  createdAt: number;
}

/**
 * DataTable entity - stored separately from DataSource.
 */
export interface DataTableEntity {
  id: UUID;
  dataSourceId: UUID;
  name: string;
  table: string;
  sourceSchema?: SourceSchema;
  fields: Field[];
  metrics: Metric[];
  dataFrameId?: UUID;
  createdAt: number;
  lastFetchedAt?: number;
}

/**
 * Insight entity - query configuration for data analysis.
 * Results are computed on-demand via DuckDB, not cached.
 */
export interface InsightEntity {
  id: UUID;
  name: string;
  baseTableId: UUID;
  selectedFields: UUID[];
  metrics: InsightMetric[];
  filters?: Array<{
    field: string;
    operator: string;
    value: unknown;
  }>;
  sorts?: Array<{
    field: string;
    direction: "asc" | "desc";
  }>;
  joins?: Array<{
    type: "inner" | "left" | "right" | "full";
    rightTableId: UUID;
    // Simple single-key joins. Complex conditions (composite keys, expressions)
    // can be added later if needed.
    leftKey: string;
    rightKey: string;
  }>;
  createdAt: number;
  updatedAt?: number;
}

/**
 * Visualization entity - Vega-Lite chart configuration.
 * Active selection is managed in UI state, not persisted.
 */
export interface VisualizationEntity {
  id: UUID;
  name: string;
  insightId: UUID;
  visualizationType: VisualizationType;
  encoding?: VisualizationEncoding;
  spec: VegaLiteSpec;
  createdAt: number;
  updatedAt?: number;
}

/**
 * Dashboard item type - supports visualizations and markdown content.
 */
export type DashboardItemType = "visualization" | "markdown";

/**
 * Dashboard item - a positioned widget on a dashboard.
 */
export interface DashboardItemEntity {
  id: UUID;
  type: DashboardItemType;
  visualizationId?: UUID; // Only for type="visualization"
  content?: string; // Only for type="markdown"
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Dashboard entity - layout of items.
 */
export interface DashboardEntity {
  id: UUID;
  name: string;
  description?: string;
  items: DashboardItemEntity[];
  createdAt: number;
  updatedAt?: number;
}

/**
 * DataFrame entity - metadata for DataFrame instances.
 * The actual Arrow data is stored separately in IndexedDB via @dashframe/engine-browser.
 */
export interface DataFrameEntity extends DataFrameJSON {
  name: string;
  insightId?: UUID; // Link to insight that produced this DataFrame
  rowCount?: number; // Cached for display (may be stale)
  columnCount?: number;
  /** Cached column analysis - computed at upload/sync time */
  analysis?: DataFrameAnalysis;
}

/**
 * Settings entity - key-value store for application settings.
 */
export interface SettingsEntity {
  key: string; // Unique key
  value: string; // Serialized value
}

// ============================================================================
// Dexie Database Class
// ============================================================================

/**
 * DashFrame Dexie database.
 *
 * Uses flat tables with foreign key relationships:
 * - dataSources: Main data source records
 * - dataTables: Tables within data sources (dataSourceId FK)
 * - insights: Query configurations (baseTableId FK)
 * - visualizations: Charts (insightId FK)
 * - dashboards: Dashboard layouts
 * - dataFrames: DataFrame metadata (insightId FK)
 * - settings: Key-value store for app settings
 */
export class DashFrameDB extends Dexie {
  dataSources!: EntityTable<DataSourceEntity, "id">;
  dataTables!: EntityTable<DataTableEntity, "id">;
  insights!: EntityTable<InsightEntity, "id">;
  visualizations!: EntityTable<VisualizationEntity, "id">;
  dashboards!: EntityTable<DashboardEntity, "id">;
  dataFrames!: EntityTable<DataFrameEntity, "id">;
  settings!: EntityTable<SettingsEntity, "key">;

  constructor() {
    super("dashframe");

    // Version 1: Initial schema
    this.version(1).stores({
      dataSources: "id, type, createdAt",
      dataTables: "id, dataSourceId, createdAt",
      insights: "id, baseTableId, createdAt",
      visualizations: "id, insightId, createdAt",
      dashboards: "id, createdAt",
      dataFrames: "id, insightId, createdAt",
    });

    // Version 2: Add settings table for encryption
    this.version(2).stores({
      dataSources: "id, type, createdAt",
      dataTables: "id, dataSourceId, createdAt",
      insights: "id, baseTableId, createdAt",
      visualizations: "id, insightId, createdAt",
      dashboards: "id, createdAt",
      dataFrames: "id, insightId, createdAt",
      settings: "key", // Key-value store with key as primary key
    });
  }
}

// ============================================================================
// Singleton Database Instance (Lazy-loaded for SSR safety)
// ============================================================================

/**
 * Lazily-initialized database instance.
 * This avoids creating the database during SSR where IndexedDB doesn't exist.
 */
let _db: DashFrameDB | null = null;

function getDatabase(): DashFrameDB {
  // Guard against SSR - IndexedDB only exists in browser
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    throw new Error(
      "[DashFrame] Database cannot be accessed during server-side rendering. " +
        "Ensure database operations are only performed in client components " +
        "after the component has mounted.",
    );
  }

  // Lazy initialization
  if (!_db) {
    _db = new DashFrameDB();
  }
  return _db;
}

/**
 * Singleton database instance.
 *
 * Uses a Proxy to lazily initialize the database on first access.
 * This ensures the database is only created in browser environments,
 * preventing SSR errors when the module is imported on the server.
 */
export const db: DashFrameDB = new Proxy({} as DashFrameDB, {
  get(_, prop) {
    const instance = getDatabase();
    const value = instance[prop as keyof DashFrameDB];
    // Bind methods to the instance
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
});
