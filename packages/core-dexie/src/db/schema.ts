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
    id?: string;
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

/**
 * Check if we're running in a browser environment.
 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

/**
 * Get the database instance, creating it lazily if needed.
 * Returns null during SSR.
 */
function getDatabase(): DashFrameDB | null {
  if (!isBrowser()) {
    return null;
  }

  if (!_db) {
    _db = new DashFrameDB();
  }
  return _db;
}

/**
 * SSR table method handlers - maps method names to no-op implementations.
 * Using a lookup table reduces cognitive complexity compared to if-else chains.
 */
const SSR_TABLE_METHODS: Record<
  string,
  (() => unknown) | (() => Promise<unknown>) | undefined
> = {
  // Methods returning empty arrays
  toArray: async () => [],
  bulkGet: async () => [],
  sortBy: async () => [],
  // Methods returning undefined
  get: async () => undefined,
  first: async () => undefined,
  last: async () => undefined,
  // Methods returning primitives
  count: async () => 0,
  delete: async () => {},
  add: async () => "",
  put: async () => "",
  update: async () => 0,
  // Not a promise
  then: undefined,
};

/** Methods that return chainable proxies */
const SSR_CHAINABLE_METHODS = new Set([
  "where",
  "equals",
  "filter",
  "limit",
  "offset",
  "reverse",
]);

/**
 * Create a no-op proxy for Dexie tables during SSR.
 * Returns promises that resolve to empty results, allowing useLiveQuery
 * to complete without errors during server-side rendering.
 */
function createSSRTableProxy(): unknown {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (typeof prop !== "string") return createSSRTableProxy();

      // Check lookup table for known methods
      if (prop in SSR_TABLE_METHODS) {
        return SSR_TABLE_METHODS[prop];
      }

      // Check chainable methods
      if (SSR_CHAINABLE_METHODS.has(prop)) {
        return () => createSSRTableProxy();
      }

      // Default: return self for chaining
      return createSSRTableProxy();
    },
  };
  return new Proxy({}, handler);
}

/**
 * Singleton database instance.
 *
 * Uses a Proxy to lazily initialize the database on first access.
 * During SSR, returns no-op table proxies that return empty results,
 * allowing useLiveQuery hooks to complete without errors.
 */
export const db: DashFrameDB = new Proxy({} as DashFrameDB, {
  get(_, prop) {
    const instance = getDatabase();

    // During SSR, return no-op proxies for table access
    if (!instance) {
      // Table properties (dataSources, insights, etc.)
      if (
        typeof prop === "string" &&
        [
          "dataSources",
          "dataTables",
          "insights",
          "visualizations",
          "dashboards",
          "dataFrames",
          "settings",
        ].includes(prop)
      ) {
        return createSSRTableProxy();
      }
      // Other methods - return no-ops
      if (prop === "open") return async () => {};
      if (prop === "close") return async () => {};
      if (prop === "transaction") return async () => {};
      return undefined;
    }

    const value = instance[prop as keyof DashFrameDB];
    // Bind methods to the instance
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
});
