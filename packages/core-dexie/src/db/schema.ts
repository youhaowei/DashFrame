import Dexie, { type EntityTable } from "dexie";
import type {
  UUID,
  Field,
  Metric,
  SourceSchema,
  InsightMetric,
  VegaLiteSpec,
} from "@dashframe/core";

// ============================================================================
// Database Entity Types (Flat Tables)
// ============================================================================

/**
 * DataSource entity - stored as flat record.
 */
export interface DataSourceEntity {
  id: UUID;
  type: "local" | "notion";
  name: string;
  apiKey?: string; // Only for Notion
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
 * Insight entity.
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
    leftKey: string;
    rightKey: string;
  }>;
  status: "pending" | "computing" | "ready" | "error";
  error?: string;
  dataFrameId?: UUID;
  createdAt: number;
  updatedAt?: number;
}

/**
 * Visualization entity.
 */
export interface VisualizationEntity {
  id: UUID;
  name: string;
  insightId: UUID;
  spec: VegaLiteSpec;
  isActive?: boolean;
  createdAt: number;
  updatedAt?: number;
}

/**
 * Dashboard entity.
 */
export interface DashboardEntity {
  id: UUID;
  name: string;
  description?: string;
  panels: Array<{
    id: UUID;
    visualizationId: UUID;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  createdAt: number;
  updatedAt?: number;
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
 */
export class DashFrameDB extends Dexie {
  dataSources!: EntityTable<DataSourceEntity, "id">;
  dataTables!: EntityTable<DataTableEntity, "id">;
  insights!: EntityTable<InsightEntity, "id">;
  visualizations!: EntityTable<VisualizationEntity, "id">;
  dashboards!: EntityTable<DashboardEntity, "id">;

  constructor() {
    super("dashframe");

    this.version(1).stores({
      dataSources: "id, type, createdAt",
      dataTables: "id, dataSourceId, createdAt",
      insights: "id, baseTableId, status, createdAt",
      visualizations: "id, insightId, createdAt",
      dashboards: "id, createdAt",
    });
  }
}

// Singleton database instance
export const db = new DashFrameDB();
