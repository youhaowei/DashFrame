/**
 * Dashboards data hooks — WyStack implementation of the Dexie hook surface.
 *
 * Names and shapes are byte-for-byte identical to `@dashframe/core-dexie`'s
 * dashboards repository, so the ~41 app components import the same symbols and
 * never change. Only the implementation differs: reads go through WyStack
 * `useQuery` (HTTP fetch + WS live-invalidation) instead of Dexie
 * `useLiveQuery`, and writes go through `useMutation` instead of direct
 * `db.dashboards.*` calls.
 *
 * Two adaptations bridge the API gap:
 *   - Result shape: WyStack's TanStack `UseQueryResult` → the domain's
 *     `{ data, isLoading }`.
 *   - Mutation calling convention: Dexie's positional args
 *     (`create(name, description)`) → WyStack's single args object
 *     (`mutateAsync({ name, description })`).
 *
 * The server returns the domain `Dashboard` shape already (it maps row→domain
 * handler-side), so there's no entity→domain conversion on this side.
 */
import type {
  CreateItemInput,
  Dashboard,
  DashboardItem,
  DashboardMutations,
  UseDashboardsResult,
  UUID,
} from "@dashframe/types";
import { useMutation, useQuery } from "@wystack/client";
import { useMemo } from "react";

import { api } from "./api";
import { getWyStackClient } from "./client";
import { loose } from "./wystack-args";

/**
 * Hook to read all dashboards. Live-updates via WS invalidation whenever any
 * dashboard mutation writes the `dashboards` table on the server.
 */
export function useDashboards(): UseDashboardsResult {
  const result = useQuery(api.listDashboards);
  return {
    data: result.data as Dashboard[] | undefined,
    isLoading: result.isLoading,
  };
}

/**
 * Hook to get dashboard mutations. Returns the same async-function surface as
 * Dexie; each call adapts positional args → a WyStack args object and awaits
 * the mutation. Stable across renders (the mutate fns are referentially stable).
 */
export function useDashboardMutations(): DashboardMutations {
  const create = useMutation(api.createDashboard);
  const update = useMutation(api.updateDashboard);
  const remove = useMutation(api.removeDashboard);
  const addItem = useMutation(api.addDashboardItem);
  const updateItem = useMutation(api.updateDashboardItem);
  const removeItem = useMutation(api.removeDashboardItem);

  return useMemo(
    () => ({
      create: async (name: string, description?: string): Promise<UUID> => {
        const { id } = await create.mutateAsync(loose({ name, description }));
        return id;
      },

      update: async (
        id: UUID,
        updates: Partial<Omit<Dashboard, "id" | "createdAt">>,
      ): Promise<void> => {
        await update.mutateAsync(
          loose({
            id,
            name: updates.name,
            description: updates.description,
            items: updates.items,
          }),
        );
      },

      remove: async (id: UUID): Promise<void> => {
        await remove.mutateAsync({ id });
      },

      addItem: async (
        dashboardId: UUID,
        input: CreateItemInput,
      ): Promise<UUID> => {
        const { itemId } = await addItem.mutateAsync(
          loose({
            dashboardId,
            type: input.type,
            visualizationId: input.visualizationId,
            content: input.content,
            position: input.position,
          }),
        );
        return itemId;
      },

      updateItem: async (
        dashboardId: UUID,
        itemId: UUID,
        updates: Partial<Omit<DashboardItem, "id" | "type">>,
      ): Promise<void> => {
        await updateItem.mutateAsync({ dashboardId, itemId, updates });
      },

      removeItem: async (dashboardId: UUID, itemId: UUID): Promise<void> => {
        await removeItem.mutateAsync({ dashboardId, itemId });
      },
    }),
    [create, update, remove, addItem, updateItem, removeItem],
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
