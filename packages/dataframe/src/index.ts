// DataFrame type definitions
import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import type { QueryBuilder } from "./query-builder";

export type ColumnType = "string" | "number" | "boolean" | "date" | "unknown";

export type DataFrameColumn = {
  name: string;
  type: ColumnType;
  sourceField?: string; // Original field name from source (e.g., "page.id" from Notion)
};

export type DataFrameRow = Record<string, unknown>;

/**
 * DataFrameData - Plain object representation of DataFrame content
 * Used for in-memory data storage in Zustand stores and UI components.
 * This is the "old" DataFrame format that contains actual row data.
 */
export type DataFrameData = {
  fieldIds: UUID[];
  columns?: DataFrameColumn[];
  rows: DataFrameRow[];
};

// ============================================================================
// DataFrame Storage Architecture
// ============================================================================

/**
 * Storage location discriminated union - explicitly WHERE data is stored
 * This makes the storage location extensible for future cloud storage options
 */
export type DataFrameStorage =
  | { type: "indexeddb"; key: string } // Browser IndexedDB with Arrow IPC
  | { type: "s3"; bucket: string; key: string } // AWS S3 (future)
  | { type: "r2"; accountId: string; key: string }; // Cloudflare R2 (future)

/**
 * DataFrame serialization format for storage in Zustand
 * Contains only the metadata needed to reconstruct the DataFrame
 */
export type DataFrameSerialization = {
  id: UUID;
  storage: DataFrameStorage;
  fieldIds: UUID[];
  primaryKey?: string | string[];
  createdAt: number;
};

// ============================================================================
// DataFrame Class Implementation
// ============================================================================

/**
 * DataFrame - Lightweight reference with explicit storage location
 *
 * This class represents a dataset but does NOT contain the actual data.
 * Instead, it knows WHERE to find the data (storage location) and provides
 * methods to load and query that data.
 */
export class DataFrame {
  readonly id: UUID;
  readonly storage: DataFrameStorage;
  readonly fieldIds: UUID[];
  readonly primaryKey?: string | string[];
  readonly createdAt: number;

  constructor(config: DataFrameSerialization) {
    this.id = config.id;
    this.storage = config.storage;
    this.fieldIds = config.fieldIds;
    this.primaryKey = config.primaryKey;
    this.createdAt = config.createdAt;
  }

  /**
   * Entry point to query operations - loads data and returns QueryBuilder
   */
  async load(conn: AsyncDuckDBConnection): Promise<QueryBuilder> {
    // Import QueryBuilder dynamically to avoid circular dependency
    const { QueryBuilder } = await import("./query-builder");
    return new QueryBuilder(this, conn);
  }

  /**
   * Serialize DataFrame for storage
   */
  toJSON(): DataFrameSerialization {
    return {
      id: this.id,
      storage: this.storage,
      fieldIds: this.fieldIds,
      primaryKey: this.primaryKey,
      createdAt: this.createdAt,
    };
  }

  /**
   * Deserialize DataFrame from storage
   */
  static fromJSON(data: DataFrameSerialization): DataFrame {
    return new DataFrame(data);
  }

  /**
   * Static factory - create DataFrame from Arrow buffer with automatic IndexedDB storage
   */
  static async create(
    arrowBuffer: Uint8Array,
    fieldIds: UUID[],
    options?: {
      storageType?: "indexeddb" | "s3" | "r2";
      primaryKey?: string | string[];
    },
  ): Promise<DataFrame> {
    const id = crypto.randomUUID();
    const storageType = options?.storageType ?? "indexeddb";
    const { persistArrowData, generateArrowKey } = await import(
      "./persistence"
    );

    let storage: DataFrameStorage;

    switch (storageType) {
      case "indexeddb": {
        const key = generateArrowKey(id);
        await persistArrowData(key, arrowBuffer);
        storage = { type: "indexeddb", key };
        break;
      }
      case "s3":
        throw new Error("S3 storage not yet implemented");
      case "r2":
        throw new Error("R2 storage not yet implemented");
      default:
        throw new Error(`Unsupported storage type: ${storageType}`);
    }

    return new DataFrame({
      id,
      storage,
      fieldIds,
      primaryKey: options?.primaryKey,
      createdAt: Date.now(),
    });
  }

  /**
   * Get storage type for UI/display purposes
   */
  getStorageType(): string {
    switch (this.storage.type) {
      case "indexeddb":
        return "Browser Storage";
      case "s3":
        return "AWS S3";
      case "r2":
        return "Cloudflare R2";
      default:
        return "Unknown";
    }
  }
}

// UUID type for unique identifiers
// eslint-disable-next-line sonarjs/redundant-type-aliases
export type UUID = string;

// DataFrame source tracking
// DataFrames are produced by Insights (which reference DataTables/DataSources)
export type DataFrameSource = {
  insightId?: UUID; // The Insight that produced this DataFrame (for transforms/queries)
  // For simple cases (direct CSV load), insightId may be undefined
};

// DataFrame metadata for tracking source and timestamp
export type DataFrameMetadata = {
  id: UUID;
  name: string;
  source: DataFrameSource;
  timestamp: number; // Unix timestamp in milliseconds
  rowCount: number;
  columnCount: number;
};

// Enhanced DataFrame with metadata
// Note: Uses DataFrameData (plain object with rows) NOT DataFrame (class reference to storage)
export type EnhancedDataFrame = {
  metadata: DataFrameMetadata;
  data: DataFrameData;
};

// ============================================================================
// Field/Metric Architecture Types
// ============================================================================

// Foreign key reference (for join suggestions)
export type ForeignKey = {
  tableId: UUID; // Stable reference to target DataTable
  columnName: string; // Target column name
};

// Table column (discovered from source)
export type TableColumn = {
  name: string;
  type: string; // Native source type: "status", "relation", "varchar", "timestamp"
  foreignKey?: ForeignKey;
  isIdentifier?: boolean;
  isReference?: boolean;
};

// Field (user-facing column with lineage)
export type Field = {
  id: UUID;
  name: string; // User-facing name (can rename)
  tableId: UUID; // Which DataTable owns this field (lineage)
  columnName?: string; // Which TableColumn this maps to (undefined for computed fields)
  type: ColumnType; // Normalized: "string" | "number" | "date" | "boolean"
  isIdentifier?: boolean;
  isReference?: boolean;
};

// Metric (aggregation)
export type Metric = {
  id: UUID;
  name: string;
  tableId: UUID; // Which DataTable owns this metric (lineage)
  columnName?: string; // Which TableColumn to aggregate (undefined for count())
  aggregation: "sum" | "avg" | "count" | "min" | "max" | "count_distinct";
};

// InsightMetric (computed column in an Insight)
export interface InsightMetric {
  id: UUID;
  name: string;
  sourceTable: UUID; // Which table (base or joined) - for v1, always baseTable.tableId
  columnName?: string; // Which column to aggregate (undefined for count())
  aggregation: "sum" | "avg" | "count" | "min" | "max" | "count_distinct";
}

// Source schema wrapper
export type SourceSchema = {
  columns: TableColumn[];
  version: number;
  lastSyncedAt: number;
};

// ============================================================================
// QueryBuilder and Operations
// ============================================================================

export {
  QueryBuilder,
  invalidateTableCache,
  clearAllTableCaches,
} from "./query-builder";
export type {
  FilterPredicate,
  FilterOperator,
  SortOrder,
  SortDirection,
  AggregationFunction,
  Aggregation,
  JoinType,
  JoinOptions,
} from "./query-builder";

// ============================================================================
// Insight Class
// ============================================================================

export { Insight, cleanTableNameForDisplay } from "./insight";
export type {
  InsightConfiguration,
  DataTableInfo,
  DataTableField,
  InsightField,
  InsightMetricResolved,
  InsightJoin,
} from "./insight";

// ============================================================================
// Persistence Utilities
// ============================================================================

export {
  persistArrowData,
  loadArrowData,
  deleteArrowData,
  generateArrowKey,
  extractDataFrameId,
} from "./persistence";

// ============================================================================
// Analysis Utilities
// ============================================================================

// Future DataFrame utilities will go here
// Examples:
// - DataFrame validation
// - DataFrame serialization
// - Column operations
// - Row operations
// - Aggregation functions
export * from "./analyze";
