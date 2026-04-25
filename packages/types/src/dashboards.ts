import type { UseQueryResult } from "./repository-base";
import type { UUID } from "./uuid";

// ============================================================================
// Dashboard Types
// ============================================================================

/**
 * Dashboard item type - supports visualizations and markdown content.
 */
export type DashboardItemType = "visualization" | "markdown";

/**
 * Dashboard item - A positioned widget on a dashboard.
 */
export interface DashboardItem {
  id: UUID;
  type: DashboardItemType;
  visualizationId?: UUID; // Only for type="visualization"
  content?: string; // Only for type="markdown"
  /** Grid position */
  x: number;
  y: number;
  /** Grid size */
  width: number;
  height: number;
}

/**
 * Dashboard - A collection of items.
 */
export interface Dashboard {
  id: UUID;
  name: string;
  description?: string;
  items: DashboardItem[];
  createdAt: number;
  updatedAt?: number;
}

// ============================================================================
// Repository Hook Types
// ============================================================================

/**
 * Result type for useDashboards hook.
 */
export type UseDashboardsResult = UseQueryResult<Dashboard[]>;

/**
 * Input for creating a new item.
 */
export interface CreateItemInput {
  type: DashboardItemType;
  visualizationId?: UUID; // Required for type="visualization"
  content?: string; // Required for type="markdown"
  position: { x: number; y: number; width: number; height: number };
}

/**
 * Mutation methods for dashboards.
 */
export interface DashboardMutations {
  /** Create a new dashboard */
  create: (name: string, description?: string) => Promise<UUID>;

  /** Update a dashboard */
  update: (
    id: UUID,
    updates: Partial<Omit<Dashboard, "id" | "createdAt">>,
  ) => Promise<void>;

  /** Remove a dashboard */
  remove: (id: UUID) => Promise<void>;

  /** Add an item to dashboard */
  addItem: (dashboardId: UUID, input: CreateItemInput) => Promise<UUID>;

  /** Update item position/size/content */
  updateItem: (
    dashboardId: UUID,
    itemId: UUID,
    updates: Partial<Omit<DashboardItem, "id" | "type">>,
  ) => Promise<void>;

  /** Remove an item */
  removeItem: (dashboardId: UUID, itemId: UUID) => Promise<void>;
}

/**
 * Hook type for reading dashboards.
 */
export type UseDashboards = () => UseDashboardsResult;

/**
 * Hook type for dashboard mutations.
 */
export type UseDashboardMutations = () => DashboardMutations;
