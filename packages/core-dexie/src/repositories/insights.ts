import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import type {
  UUID,
  InsightMetric,
  Insight,
  InsightStatus,
  InsightFilter,
  UseInsightsResult,
  InsightMutations,
} from "@dashframe/core";
import { db, type InsightEntity } from "../db";

// ============================================================================
// Entity to Domain Conversion
// ============================================================================

function entityToInsight(entity: InsightEntity): Insight {
  return {
    id: entity.id,
    name: entity.name,
    baseTableId: entity.baseTableId,
    selectedFields: entity.selectedFields,
    metrics: entity.metrics,
    filters: entity.filters?.map((f) => ({
      field: f.field,
      operator: f.operator as InsightFilter["operator"],
      value: f.value,
    })),
    sorts: entity.sorts?.map((s) => ({
      field: s.field,
      direction: s.direction,
    })),
    joins: entity.joins?.map((j) => ({
      type: j.type,
      rightTableId: j.rightTableId,
      leftKey: j.leftKey,
      rightKey: j.rightKey,
    })),
    status: entity.status,
    error: entity.error,
    dataFrameId: entity.dataFrameId,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to read insights with optional filtering.
 */
export function useInsights(options?: {
  excludeIds?: UUID[];
  withComputedDataOnly?: boolean;
}): UseInsightsResult {
  const { excludeIds = [], withComputedDataOnly = false } = options ?? {};

  const data = useLiveQuery(async () => {
    let entities = await db.insights.toArray();

    // Filter by excludeIds
    if (excludeIds.length > 0) {
      entities = entities.filter((e) => !excludeIds.includes(e.id));
    }

    // Filter to only those with computed data
    if (withComputedDataOnly) {
      entities = entities.filter((e) => e.dataFrameId !== undefined);
    }

    return entities.map(entityToInsight);
  }, [excludeIds.join(","), withComputedDataOnly]);

  return {
    data,
    isLoading: data === undefined,
  };
}

/**
 * Hook to get insight mutations.
 */
export function useInsightMutations(): InsightMutations {
  return useMemo(
    () => ({
      create: async (
        name: string,
        baseTableId: UUID,
        options?: {
          selectedFields?: UUID[];
          metrics?: InsightMetric[];
        },
      ): Promise<UUID> => {
        const id = crypto.randomUUID();
        await db.insights.add({
          id,
          name,
          baseTableId,
          selectedFields: options?.selectedFields ?? [],
          metrics: options?.metrics ?? [],
          status: "pending",
          createdAt: Date.now(),
        });
        return id;
      },

      update: async (
        id: UUID,
        updates: Partial<Omit<Insight, "id" | "createdAt">>,
      ): Promise<void> => {
        await db.insights.update(id, {
          ...updates,
          updatedAt: Date.now(),
        });
      },

      remove: async (id: UUID): Promise<void> => {
        // Also delete related visualizations
        await db.visualizations.where("insightId").equals(id).delete();
        await db.insights.delete(id);
      },

      setStatus: async (
        id: UUID,
        status: InsightStatus,
        error?: string,
      ): Promise<void> => {
        await db.insights.update(id, {
          status,
          error,
          updatedAt: Date.now(),
        });
      },

      setDataFrame: async (id: UUID, dataFrameId: UUID): Promise<void> => {
        await db.insights.update(id, {
          dataFrameId,
          status: "ready",
          updatedAt: Date.now(),
        });
      },

      addField: async (insightId: UUID, fieldId: UUID): Promise<void> => {
        const insight = await db.insights.get(insightId);
        if (insight && !insight.selectedFields.includes(fieldId)) {
          await db.insights.update(insightId, {
            selectedFields: [...insight.selectedFields, fieldId],
            updatedAt: Date.now(),
          });
        }
      },

      removeField: async (insightId: UUID, fieldId: UUID): Promise<void> => {
        const insight = await db.insights.get(insightId);
        if (insight) {
          await db.insights.update(insightId, {
            selectedFields: insight.selectedFields.filter(
              (id) => id !== fieldId,
            ),
            updatedAt: Date.now(),
          });
        }
      },

      addMetric: async (
        insightId: UUID,
        metric: InsightMetric,
      ): Promise<void> => {
        const insight = await db.insights.get(insightId);
        if (insight) {
          await db.insights.update(insightId, {
            metrics: [...insight.metrics, metric],
            updatedAt: Date.now(),
          });
        }
      },

      updateMetric: async (
        insightId: UUID,
        metricId: UUID,
        updates: Partial<InsightMetric>,
      ): Promise<void> => {
        const insight = await db.insights.get(insightId);
        if (insight) {
          const metrics = insight.metrics.map((m) =>
            m.id === metricId ? { ...m, ...updates } : m,
          );
          await db.insights.update(insightId, {
            metrics,
            updatedAt: Date.now(),
          });
        }
      },

      removeMetric: async (insightId: UUID, metricId: UUID): Promise<void> => {
        const insight = await db.insights.get(insightId);
        if (insight) {
          await db.insights.update(insightId, {
            metrics: insight.metrics.filter((m) => m.id !== metricId),
            updatedAt: Date.now(),
          });
        }
      },
    }),
    [],
  );
}

// ============================================================================
// Direct Access Functions
// ============================================================================

export async function getInsight(id: UUID): Promise<Insight | undefined> {
  const entity = await db.insights.get(id);
  return entity ? entityToInsight(entity) : undefined;
}

export async function getAllInsights(): Promise<Insight[]> {
  const entities = await db.insights.toArray();
  return entities.map(entityToInsight);
}
