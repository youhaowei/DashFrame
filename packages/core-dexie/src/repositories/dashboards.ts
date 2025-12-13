import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import type {
  UUID,
  Dashboard,
  DashboardPanel,
  UseDashboardsResult,
  DashboardMutations,
} from "@dashframe/core";
import { db, type DashboardEntity } from "../db";

// ============================================================================
// Entity to Domain Conversion
// ============================================================================

function entityToDashboard(entity: DashboardEntity): Dashboard {
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    panels: entity.panels,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to read all dashboards.
 */
export function useDashboards(): UseDashboardsResult {
  const data = useLiveQuery(async () => {
    const entities = await db.dashboards.toArray();
    return entities.map(entityToDashboard);
  });

  return {
    data,
    isLoading: data === undefined,
  };
}

/**
 * Hook to get dashboard mutations.
 */
export function useDashboardMutations(): DashboardMutations {
  return useMemo(
    () => ({
      create: async (name: string, description?: string): Promise<UUID> => {
        const id = crypto.randomUUID();
        await db.dashboards.add({
          id,
          name,
          description,
          panels: [],
          createdAt: Date.now(),
        });
        return id;
      },

      update: async (
        id: UUID,
        updates: Partial<Omit<Dashboard, "id" | "createdAt">>,
      ): Promise<void> => {
        await db.dashboards.update(id, {
          ...updates,
          updatedAt: Date.now(),
        });
      },

      remove: async (id: UUID): Promise<void> => {
        await db.dashboards.delete(id);
      },

      addPanel: async (
        dashboardId: UUID,
        visualizationId: UUID,
        position: { x: number; y: number; width: number; height: number },
      ): Promise<UUID> => {
        const dashboard = await db.dashboards.get(dashboardId);
        if (!dashboard) throw new Error(`Dashboard ${dashboardId} not found`);

        const panelId = crypto.randomUUID();
        const panel: DashboardPanel = {
          id: panelId,
          visualizationId,
          ...position,
        };

        await db.dashboards.update(dashboardId, {
          panels: [...dashboard.panels, panel],
          updatedAt: Date.now(),
        });

        return panelId;
      },

      updatePanel: async (
        dashboardId: UUID,
        panelId: UUID,
        updates: Partial<Omit<DashboardPanel, "id" | "visualizationId">>,
      ): Promise<void> => {
        const dashboard = await db.dashboards.get(dashboardId);
        if (!dashboard) return;

        const panels = dashboard.panels.map((p) =>
          p.id === panelId ? { ...p, ...updates } : p,
        );

        await db.dashboards.update(dashboardId, {
          panels,
          updatedAt: Date.now(),
        });
      },

      removePanel: async (dashboardId: UUID, panelId: UUID): Promise<void> => {
        const dashboard = await db.dashboards.get(dashboardId);
        if (!dashboard) return;

        await db.dashboards.update(dashboardId, {
          panels: dashboard.panels.filter((p) => p.id !== panelId),
          updatedAt: Date.now(),
        });
      },
    }),
    [],
  );
}

// ============================================================================
// Direct Access Functions
// ============================================================================

export async function getDashboard(id: UUID): Promise<Dashboard | undefined> {
  const entity = await db.dashboards.get(id);
  return entity ? entityToDashboard(entity) : undefined;
}

export async function getAllDashboards(): Promise<Dashboard[]> {
  const entities = await db.dashboards.toArray();
  return entities.map(entityToDashboard);
}
