import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import type {
  UUID,
  Dashboard,
  DashboardItem,
  CreateItemInput,
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
    items: entity.items,
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
          items: [],
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

      addItem: async (
        dashboardId: UUID,
        input: CreateItemInput,
      ): Promise<UUID> => {
        const dashboard = await db.dashboards.get(dashboardId);
        if (!dashboard) throw new Error(`Dashboard ${dashboardId} not found`);

        const itemId = crypto.randomUUID();
        const item: DashboardItem = {
          id: itemId,
          type: input.type,
          visualizationId: input.visualizationId,
          content: input.content,
          ...input.position,
        };

        await db.dashboards.update(dashboardId, {
          items: [...dashboard.items, item],
          updatedAt: Date.now(),
        });

        return itemId;
      },

      updateItem: async (
        dashboardId: UUID,
        itemId: UUID,
        updates: Partial<Omit<DashboardItem, "id" | "type">>,
      ): Promise<void> => {
        const dashboard = await db.dashboards.get(dashboardId);
        if (!dashboard) return;

        const items = dashboard.items.map((item) =>
          item.id === itemId ? { ...item, ...updates } : item,
        );

        await db.dashboards.update(dashboardId, {
          items,
          updatedAt: Date.now(),
        });
      },

      removeItem: async (dashboardId: UUID, itemId: UUID): Promise<void> => {
        const dashboard = await db.dashboards.get(dashboardId);
        if (!dashboard) return;

        await db.dashboards.update(dashboardId, {
          items: dashboard.items.filter((item) => item.id !== itemId),
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
