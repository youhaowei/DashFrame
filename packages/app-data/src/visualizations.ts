import type {
  UseVisualizationsResult,
  UUID,
  VegaLiteSpec,
  Visualization,
  VisualizationEncoding,
  VisualizationMutations,
  VisualizationType,
} from "@dashframe/types";
import { useMutation, useQuery } from "@wystack/client";
import { useMemo } from "react";

import { api } from "./api";
import { getWyStackClient } from "./client";
import { loose } from "./wystack-args";

export function useVisualizations(insightId?: UUID): UseVisualizationsResult {
  const result = useQuery(api.listVisualizations, {
    args: loose({ insightId }),
  });
  return {
    data: result.data as Visualization[] | undefined,
    isLoading: result.isLoading,
  };
}

export function useVisualizationMutations(): VisualizationMutations {
  const createMutation = useMutation(api.createVisualization);
  const updateMutation = useMutation(api.updateVisualization);
  const removeMutation = useMutation(api.removeVisualization);

  return useMemo(
    () => ({
      create: async (
        name: string,
        insightId: UUID,
        visualizationType: VisualizationType,
        spec: VegaLiteSpec,
        encoding?: VisualizationEncoding,
      ): Promise<UUID> => {
        const { id } = await createMutation.mutateAsync(
          loose({ name, insightId, visualizationType, spec, encoding }),
        );
        return id;
      },
      update: async (
        id: UUID,
        updates: Partial<Omit<Visualization, "id" | "createdAt" | "insightId">>,
      ): Promise<void> => {
        await updateMutation.mutateAsync({ id, updates });
      },
      remove: async (id: UUID): Promise<void> => {
        await removeMutation.mutateAsync({ id });
      },
      updateSpec: async (id: UUID, spec: VegaLiteSpec): Promise<void> => {
        await updateMutation.mutateAsync({ id, updates: { spec } });
      },
      updateEncoding: async (
        id: UUID,
        encoding: VisualizationEncoding,
      ): Promise<void> => {
        await updateMutation.mutateAsync({ id, updates: { encoding } });
      },
    }),
    [createMutation, removeMutation, updateMutation],
  );
}

export async function getVisualization(
  id: UUID,
): Promise<Visualization | undefined> {
  const result = await getWyStackClient().query(api.getVisualization, { id });
  return (result as Visualization | null) ?? undefined;
}

export async function getVisualizationsByInsight(
  insightId: UUID,
): Promise<Visualization[]> {
  const result = await getWyStackClient().query(
    api.listVisualizations,
    loose({ insightId }),
  );
  return result as Visualization[];
}

export async function getAllVisualizations(): Promise<Visualization[]> {
  const result = await getWyStackClient().query(
    api.listVisualizations,
    loose({}),
  );
  return result as Visualization[];
}
