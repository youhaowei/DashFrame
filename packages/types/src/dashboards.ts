import type { InsightFilter, InsightSort } from "./insights";
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
 * Per-cell overrides applied on top of an insight's default params at compile
 * time.  Only shape-preserving params are overrideable — fields and metrics are
 * excluded because changing them would alter the query's output columns and
 * break the visualization encoding.
 *
 * Absent key → inherit from insight default.
 * Explicit clear (InsightFilterOverride with `cleared: true`) → remove the
 * insight's filter for that field so the cell widens (shows all values).
 *
 * Design note: `filters` here is the effective cell override.  How the value
 * gets populated (direct pin vs a future dashboard-control binding) is upstream;
 * the coalesce function in the engine is two-layer (`insight ⊕ effectiveCellOverride`)
 * so a control can write into this slot without a resolution-layer change.
 */
export interface DashboardItemOverrides {
  /**
   * Per-field filter overrides.  Each entry either pins a value (normal
   * InsightFilter) or clears the insight's filter on that field (when
   * `cleared: true`).  Fields not mentioned fall through to the insight default.
   */
  filters?: InsightFilterOverride[];
  /** Sort override — replaces the insight's sorts array when present. */
  sorts?: InsightSort[];
  /** Row-limit override — replaces the insight's limit when present. */
  limit?: number;
}

/**
 * An InsightFilter entry extended with an optional explicit-clear sentinel.
 *
 * When `cleared` is `true` this entry signals "remove the insight's filter for
 * this field" rather than applying a predicate.  This is a DISTINCT signal from
 * absence: absence means inherit, cleared means widen.
 *
 * v0.3: clear widens freely — no permission gate (single-user data only).
 * Multi-tenant widening-permission logic is explicitly deferred to v0.4+.
 */
export interface InsightFilterOverride extends InsightFilter {
  /**
   * When `true`, the insight's filter(s) on this field are REMOVED from the
   * effective params.  `operator` and `value` are ignored when `cleared` is set.
   */
  cleared?: boolean;
}

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
  /**
   * Per-cell param overrides applied on top of the insight's defaults at compile
   * time.  Absent = no overrides (the cell renders with the insight's defaults).
   * Only filters, sorts, and limit are overrideable; fields and metrics are not.
   */
  overrides?: DashboardItemOverrides;
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
