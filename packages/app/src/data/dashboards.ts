/**
 * Dashboards data hooks — WyStack server implementation.
 *
 * Reads go through WyStack `useQuery` (HTTP fetch + WS live-invalidation)
 * and writes go through `useMutation`. The server returns the domain
 * `Dashboard` shape already (it maps row→domain handler-side), so there's
 * no entity→domain conversion on this side.
 */
import type {
  CreateItemInput,
  Dashboard,
  DashboardControl,
  DashboardItem,
  DashboardItemOverridePatch,
  DashboardItemPatch,
  DashboardMutations,
  UseDashboardsResult,
  UUID,
} from "@dashframe/types";
import { useMutation, useQuery } from "@wystack/client";
import { useMemo } from "react";

import { api } from "../wystack/api";
import { getWyStackClient } from "../wystack/client";

/**
 * Hook to read all dashboards. Live-updates via WS invalidation whenever any
 * dashboard mutation writes the `dashboards` table on the server.
 */
export function useDashboards(): UseDashboardsResult {
  const result = useQuery(api.listDashboards);
  return {
    data: result.data as Dashboard[] | undefined,
    isLoading: result.isLoading,
    isFetching: result.isFetching,
  };
}

/**
 * Hook to get dashboard mutations. Each call adapts positional args → a WyStack
 * args object and awaits the mutation. Stable across renders (the mutate fns
 * are referentially stable).
 */
export function useDashboardMutations(): DashboardMutations {
  const create = useMutation(api.createDashboard);
  const update = useMutation(api.updateDashboard);
  const remove = useMutation(api.removeDashboard);
  const addItem = useMutation(api.addDashboardItem);
  const updateItem = useMutation(api.updateDashboardItem);
  const updateItems = useMutation(api.updateDashboardItems);
  const patchItemOverride = useMutation(api.patchDashboardItemOverride);
  const removeItem = useMutation(api.removeDashboardItem);
  const updateControlsMutation = useMutation(api.updateDashboardControls);

  return useMemo(
    () => ({
      create: async (name: string, description?: string): Promise<UUID> => {
        const { id } = await create.mutateAsync({ name, description });
        return id;
      },

      update: async (
        id: UUID,
        updates: Pick<Partial<Dashboard>, "name" | "description">,
      ): Promise<void> => {
        await update.mutateAsync({
          id,
          name: updates.name,
          description: updates.description,
        });
      },

      remove: async (id: UUID): Promise<void> => {
        await remove.mutateAsync({ id });
      },

      addItem: async (
        dashboardId: UUID,
        input: CreateItemInput,
      ): Promise<UUID> => {
        const { itemId } = await addItem.mutateAsync({
          dashboardId,
          type: input.type,
          visualizationId: input.visualizationId,
          content: input.content,
          position: input.position,
        });
        return itemId;
      },

      updateItem: async (
        dashboardId: UUID,
        itemId: UUID,
        updates: Partial<Omit<DashboardItem, "id" | "type" | "overrides">>,
      ): Promise<void> => {
        await updateItem.mutateAsync({ dashboardId, itemId, updates });
      },

      updateItems: async (
        dashboardId: UUID,
        patches: DashboardItemPatch[],
      ): Promise<void> => {
        await updateItems.mutateAsync({ dashboardId, patches });
      },

      patchItemOverride: async (
        dashboardId: UUID,
        itemId: UUID,
        patch: DashboardItemOverridePatch,
      ): Promise<void> => {
        await patchItemOverride.mutateAsync({ dashboardId, itemId, patch });
      },

      removeItem: async (dashboardId: UUID, itemId: UUID): Promise<void> => {
        await removeItem.mutateAsync({ dashboardId, itemId });
      },

      updateControls: async (
        dashboardId: UUID,
        controls: DashboardControl[],
      ): Promise<void> => {
        await updateControlsMutation.mutateAsync({
          dashboardId,
          controls,
        });
      },
    }),
    [
      create,
      update,
      remove,
      addItem,
      updateItem,
      updateItems,
      patchItemOverride,
      removeItem,
      updateControlsMutation,
    ],
  );
}

// ============================================================================
// Direct Access Functions (non-React contexts) — via the imperative client.
// ============================================================================

export async function getDashboard(id: UUID): Promise<Dashboard | undefined> {
  const result = await getWyStackClient().query(api.getDashboard, { id });
  return (result as Dashboard | null) ?? undefined;
}

export async function getAllDashboards(): Promise<Dashboard[]> {
  const result = await getWyStackClient().query(api.listDashboards, {});
  return result as Dashboard[];
}
