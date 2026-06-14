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

// ============================================================================
// Dashboard Controls
// ============================================================================

/**
 * A dashboard-level control bound to a single insight field.
 *
 * A control broadcasts its current value into the override slot of explicitly
 * listed cells (`boundInstances`).  Binding is ALWAYS explicit opt-in — a
 * control NEVER silently reaches cells.  `defaultValue` is applied immediately
 * on dashboard load.
 *
 * Source-schema applicability: a control on field F can only be bound to cells
 * whose insight's source table has F in its schema (even if F is dropped by
 * GROUP BY in the result).  This check is enforced at the binding site, not here.
 *
 * Per §6 of the override spec: binding = delegation.  When a cell is in
 * `boundInstances`, the control OWNS the field; the cell's own pinned value is
 * shadowed while bound.
 *
 * Viewer turns: a viewer changing a control must NOT mutate the saved
 * `defaultValue`.  The resolution layer supports a transient overlay on top of
 * the saved value — the full viewer-transient UX is deferred to a later ticket.
 */
export interface DashboardControl {
  /** Stable client-generated id (UUID). */
  id: UUID;
  /**
   * The source column name this control is keyed on
   * (matches `Field.columnName ?? Field.name`).
   */
  field: string;
  /**
   * Human-readable label shown in the control bar.  Defaults to the field name
   * when absent.
   */
  label?: string;
  /**
   * The saved author default.  Applied to bound cells immediately on dashboard
   * load.  A viewer's transient turn does NOT write back here.
   */
  defaultValue?: InsightFilter["value"];
  /**
   * Explicit allowlist of `DashboardItem.id` values this control drives.
   * NEVER auto-populated — binding is always a deliberate author act.
   * A cell not listed here is not affected even if its source schema has F.
   */
  boundInstances: UUID[];
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
  /**
   * Dashboard-level controls.  Each control broadcasts its value to the
   * override slot of its `boundInstances` cells, driving per-field filters
   * across multiple panels from a single input.
   *
   * Absent or empty = no controls.
   */
  controls?: DashboardControl[];
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

  /**
   * Persist the dashboard's controls array.  Replaces the entire array — the
   * caller is responsible for merging if only a single control changed.
   * Only the author uses this; viewer turns go through the transient overlay
   * in `useDashboardControls`.
   */
  updateControls: (
    dashboardId: UUID,
    controls: DashboardControl[],
  ) => Promise<void>;
}

/**
 * Hook type for reading dashboards.
 */
export type UseDashboards = () => UseDashboardsResult;

/**
 * Hook type for dashboard mutations.
 */
export type UseDashboardMutations = () => DashboardMutations;
