import type { UUID } from "../types";
import type { UseQueryResult } from "./types";

// ============================================================================
// Dashboard Types
// ============================================================================

/**
 * Dashboard panel - A visualization placed on a dashboard.
 */
export interface DashboardPanel {
  id: UUID;
  visualizationId: UUID;
  /** Grid position */
  x: number;
  y: number;
  /** Grid size */
  width: number;
  height: number;
}

/**
 * Dashboard - A collection of visualization panels.
 */
export interface Dashboard {
  id: UUID;
  name: string;
  description?: string;
  panels: DashboardPanel[];
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

  /** Add a panel to dashboard */
  addPanel: (
    dashboardId: UUID,
    visualizationId: UUID,
    position: { x: number; y: number; width: number; height: number },
  ) => Promise<UUID>;

  /** Update panel position/size */
  updatePanel: (
    dashboardId: UUID,
    panelId: UUID,
    updates: Partial<Omit<DashboardPanel, "id" | "visualizationId">>,
  ) => Promise<void>;

  /** Remove a panel */
  removePanel: (dashboardId: UUID, panelId: UUID) => Promise<void>;
}

/**
 * Hook type for reading dashboards.
 */
export type UseDashboards = () => UseDashboardsResult;

/**
 * Hook type for dashboard mutations.
 */
export type UseDashboardMutations = () => DashboardMutations;
