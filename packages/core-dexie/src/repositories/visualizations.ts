import type {
  UseVisualizationsResult,
  UUID,
  VegaLiteSpec,
  Visualization,
  VisualizationEncoding,
  VisualizationMutations,
  VisualizationType,
} from "@dashframe/types";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db, type VisualizationEntity } from "../db";

// ============================================================================
// Entity to Domain Conversion
// ============================================================================

function entityToVisualization(entity: VisualizationEntity): Visualization {
  return {
    id: entity.id,
    name: entity.name,
    insightId: entity.insightId,
    visualizationType: entity.visualizationType,
    encoding: entity.encoding,
    spec: entity.spec,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to read visualizations, optionally filtered by insight.
 */
export function useVisualizations(insightId?: UUID): UseVisualizationsResult {
  const data = useLiveQuery(async () => {
    let entities: VisualizationEntity[];
    if (insightId) {
      entities = await db.visualizations
        .where("insightId")
        .equals(insightId)
        .toArray();
    } else {
      entities = await db.visualizations.toArray();
    }
    return entities.map(entityToVisualization);
  }, [insightId]);

  return {
    data,
    isLoading: data === undefined,
  };
}

/**
 * Strips embedded data from a Vega-Lite spec before storing.
 * Data should be loaded from the source DataFrame at render time, not stored.
 * This prevents storage bloat and avoids serialization issues with Arrow Row objects.
 */
function stripDataFromSpec(spec: VegaLiteSpec): VegaLiteSpec {
  const specWithoutData = { ...spec } as Record<string, unknown>;
  if ("data" in specWithoutData) {
    delete specWithoutData.data;
  }
  return specWithoutData as VegaLiteSpec;
}

/**
 * Hook to get visualization mutations.
 */
export function useVisualizationMutations(): VisualizationMutations {
  return useMemo(
    () => ({
      create: async (
        name: string,
        insightId: UUID,
        visualizationType: VisualizationType,
        spec: VegaLiteSpec,
        encoding?: VisualizationEncoding,
      ): Promise<UUID> => {
        const id = crypto.randomUUID();
        // Strip data from spec - data will be loaded from source at render time
        const specToStore = stripDataFromSpec(spec);
        await db.visualizations.add({
          id,
          name,
          insightId,
          visualizationType,
          encoding,
          spec: specToStore,
          createdAt: Date.now(),
        });
        return id;
      },

      update: async (
        id: UUID,
        updates: Partial<Omit<Visualization, "id" | "createdAt" | "insightId">>,
      ): Promise<void> => {
        // If spec is being updated, strip embedded data
        const updatesToStore = updates.spec
          ? { ...updates, spec: stripDataFromSpec(updates.spec) }
          : updates;
        await db.visualizations.update(id, {
          ...updatesToStore,
          updatedAt: Date.now(),
        });
      },

      remove: async (id: UUID): Promise<void> => {
        await db.visualizations.delete(id);
      },

      updateSpec: async (id: UUID, spec: VegaLiteSpec): Promise<void> => {
        // Strip data from spec - data will be loaded from source at render time
        const specToStore = stripDataFromSpec(spec);
        await db.visualizations.update(id, {
          spec: specToStore,
          updatedAt: Date.now(),
        });
      },

      updateEncoding: async (
        id: UUID,
        encoding: VisualizationEncoding,
      ): Promise<void> => {
        await db.visualizations.update(id, {
          encoding,
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

export async function getVisualization(
  id: UUID,
): Promise<Visualization | undefined> {
  const entity = await db.visualizations.get(id);
  return entity ? entityToVisualization(entity) : undefined;
}

export async function getVisualizationsByInsight(
  insightId: UUID,
): Promise<Visualization[]> {
  const entities = await db.visualizations
    .where("insightId")
    .equals(insightId)
    .toArray();
  return entities.map(entityToVisualization);
}

export async function getAllVisualizations(): Promise<Visualization[]> {
  const entities = await db.visualizations.toArray();
  return entities.map(entityToVisualization);
}
