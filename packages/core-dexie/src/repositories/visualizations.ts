import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import type {
  UUID,
  VegaLiteSpec,
  Visualization,
  UseVisualizationsResult,
  VisualizationMutations,
} from "@dashframe/core";
import { db, type VisualizationEntity } from "../db";

// ============================================================================
// Entity to Domain Conversion
// ============================================================================

function entityToVisualization(entity: VisualizationEntity): Visualization {
  return {
    id: entity.id,
    name: entity.name,
    insightId: entity.insightId,
    spec: entity.spec,
    isActive: entity.isActive,
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
 * Hook to get visualization mutations.
 */
export function useVisualizationMutations(): VisualizationMutations {
  return useMemo(
    () => ({
      create: async (
        name: string,
        insightId: UUID,
        spec: VegaLiteSpec,
      ): Promise<UUID> => {
        const id = crypto.randomUUID();
        await db.visualizations.add({
          id,
          name,
          insightId,
          spec,
          isActive: true,
          createdAt: Date.now(),
        });
        return id;
      },

      update: async (
        id: UUID,
        updates: Partial<Omit<Visualization, "id" | "createdAt" | "insightId">>,
      ): Promise<void> => {
        await db.visualizations.update(id, {
          ...updates,
          updatedAt: Date.now(),
        });
      },

      remove: async (id: UUID): Promise<void> => {
        await db.visualizations.delete(id);
      },

      setActive: async (id: UUID): Promise<void> => {
        // Get the visualization to find its insight
        const viz = await db.visualizations.get(id);
        if (!viz) return;

        // Deactivate all other visualizations for this insight
        const others = await db.visualizations
          .where("insightId")
          .equals(viz.insightId)
          .toArray();

        await Promise.all(
          others.map((v) =>
            db.visualizations.update(v.id, { isActive: v.id === id }),
          ),
        );
      },

      updateSpec: async (id: UUID, spec: VegaLiteSpec): Promise<void> => {
        await db.visualizations.update(id, {
          spec,
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

export async function getActiveVisualization(
  insightId: UUID,
): Promise<Visualization | undefined> {
  const entities = await db.visualizations
    .where("insightId")
    .equals(insightId)
    .toArray();
  const active = entities.find((e) => e.isActive);
  return active ? entityToVisualization(active) : undefined;
}
