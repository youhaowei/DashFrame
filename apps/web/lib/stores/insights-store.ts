import "./config";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UUID } from "@dashframe/dataframe";
import type { Insight, InsightExecutionType, InsightMetric } from "./types";

// ============================================================================
// State Interface
// ============================================================================

interface InsightsState {
  insights: Map<UUID, Insight>;
}

interface InsightsActions {
  // Create Insight (new baseTable-based API)
  createDraft: (tableId: UUID, tableName: string, fieldIds: UUID[]) => UUID;

  // Update Insight
  updateInsight: (
    insightId: UUID,
    updates: Partial<Omit<Insight, "id" | "createdAt">>,
  ) => void;
  updateMetrics: (insightId: UUID, metrics: InsightMetric[]) => void;
  updateSelectedFields: (insightId: UUID, fieldIds: UUID[]) => void;
  updateFilters: (insightId: UUID, filters: Insight["filters"]) => void;

  // Forking
  forkInsight: (originalId: UUID) => UUID;
  mergeForkToOriginal: (forkId: UUID) => UUID | null;

  // Link DataFrame to Insight (after execution)
  setInsightDataFrame: (insightId: UUID, dataFrameId: UUID) => void;

  // Remove Insight
  removeInsight: (insightId: UUID) => void;

  // Queries
  getInsight: (insightId: UUID) => Insight | undefined;
  getInsightsByDataTable: (dataTableId: UUID) => Insight[];
  getAll: () => Insight[];

  // Clear all
  clear: () => void;

  // ===== Legacy API (deprecated) =====
  /** @deprecated Use createDraft instead */
  addInsight: (
    name: string,
    dataTableIds: UUID[],
    executionType: InsightExecutionType,
    config?: unknown,
  ) => UUID;
}

type InsightsStore = InsightsState & InsightsActions;

// ============================================================================
// Storage Serialization (for Map support)
// ============================================================================

const storage = createJSONStorage<InsightsState>(() => localStorage, {
  reviver: (_key, value) => {
    // Convert arrays back to Maps during deserialization
    if (
      value &&
      typeof value === "object" &&
      "insights" in value &&
      Array.isArray(value.insights)
    ) {
      return {
        ...value,
        insights: new Map(value.insights as [UUID, Insight][]),
      };
    }
    return value;
  },
  replacer: (_key, value) => {
    // Convert Maps to arrays for JSON serialization
    if (value instanceof Map) {
      return Array.from(value.entries());
    }
    return value;
  },
});

// ============================================================================
// Store Implementation
// ============================================================================

export const useInsightsStore = create<InsightsStore>()(
  persist(
    immer((set, get) => ({
      // Initial state
      insights: new Map(),

      // Create draft Insight (new API)
      createDraft: (tableId, tableName, fieldIds) => {
        const id = crypto.randomUUID();
        const now = Date.now();

        const insight: Insight = {
          id,
          name: tableName,
          baseTable: {
            tableId,
            selectedFields: [], // Start unconfigured to show preview + suggestions
          },
          metrics: [], // No metrics initially
          createdAt: now,
          updatedAt: now,
        };

        set((state) => {
          state.insights.set(id, insight);
        });

        return id;
      },

      // Update metrics
      updateMetrics: (insightId, metrics) => {
        set((state) => {
          const insight = state.insights.get(insightId);
          if (insight) {
            insight.metrics = metrics;
            insight.updatedAt = Date.now();
          }
        });
      },

      // Update selected fields
      updateSelectedFields: (insightId, fieldIds) => {
        set((state) => {
          const insight = state.insights.get(insightId);
          if (insight) {
            insight.baseTable.selectedFields = fieldIds;
            insight.updatedAt = Date.now();
          }
        });
      },

      // Update filters
      updateFilters: (insightId, filters) => {
        set((state) => {
          const insight = state.insights.get(insightId);
          if (insight) {
            insight.filters = filters;
            insight.updatedAt = Date.now();
          }
        });
      },

      // Fork insight (create a copy)
      forkInsight: (originalId) => {
        const original = get().insights.get(originalId);
        if (!original) {
          throw new Error(`Cannot fork: Insight ${originalId} not found`);
        }

        const forkId = crypto.randomUUID();
        const now = Date.now();

        const fork: Insight = {
          ...original,
          id: forkId,
          name: `${original.name} (copy)`,
          forkedFrom: originalId,
          createdAt: now,
          updatedAt: now,
          dataFrameId: undefined, // Fork needs its own DataFrame
          lastComputedAt: undefined,
        };

        set((state) => {
          state.insights.set(forkId, fork);
        });

        return forkId;
      },

      // Merge fork changes back to original
      mergeForkToOriginal: (forkId) => {
        const fork = get().insights.get(forkId);
        if (!fork?.forkedFrom) {
          console.error("Cannot merge: not a fork or original not found");
          return null;
        }

        const originalId = fork.forkedFrom;
        const original = get().insights.get(originalId);
        if (!original) {
          console.error(`Cannot merge: original insight ${originalId} not found`);
          return null;
        }

        // Copy fork changes to original
        set((state) => {
          const orig = state.insights.get(originalId);
          if (orig) {
            orig.baseTable = { ...fork.baseTable };
            orig.metrics = [...fork.metrics];
            orig.filters = fork.filters ? { ...fork.filters } : undefined;
            orig.updatedAt = Date.now();
            // Clear cached DataFrame - will need recomputation
            orig.dataFrameId = undefined;
            orig.lastComputedAt = undefined;
          }
        });

        return originalId;
      },

      // ===== Legacy API =====

      // Add new Insight (deprecated)
      addInsight: (name, dataTableIds, executionType, config) => {
        const id = crypto.randomUUID();
        const now = Date.now();

        const insight: Insight = {
          id,
          name,
          // Legacy fields
          dataTableIds,
          executionType,
          config,
          // New fields (set defaults for backward compatibility)
          baseTable: {
            tableId: dataTableIds[0] || "",
            selectedFields: [],
          },
          metrics: [],
          createdAt: now,
          updatedAt: now,
        };

        set((state) => {
          state.insights.set(id, insight);
        });

        return id;
      },

      // Update Insight
      updateInsight: (insightId, updates) => {
        set((state) => {
          const insight = state.insights.get(insightId);
          if (insight) {
            Object.assign(insight, updates);
          }
        });
      },

      // Link DataFrame result to Insight
      setInsightDataFrame: (insightId, dataFrameId) => {
        set((state) => {
          const insight = state.insights.get(insightId);
          if (insight) {
            insight.dataFrameId = dataFrameId;
          }
        });
      },

      // Remove Insight
      removeInsight: (insightId) => {
        set((state) => {
          state.insights.delete(insightId);
        });
      },

      // Get single Insight
      getInsight: (insightId) => {
        return get().insights.get(insightId);
      },

      // Get all Insights that use a specific DataTable
      getInsightsByDataTable: (dataTableId) => {
        const allInsights = Array.from(get().insights.values());
        return allInsights.filter((insight) => {
          // Check new baseTable structure
          if (insight.baseTable?.tableId === dataTableId) return true;
          // Check legacy dataTableIds
          return insight.dataTableIds?.includes(dataTableId) ?? false;
        });
      },

      // Get all Insights
      getAll: () => {
        return Array.from(get().insights.values());
      },

      // Clear all
      clear: () => {
        set((state) => {
          state.insights.clear();
        });
      },
    })),
    {
      name: "dashframe:insights",
      storage,
      partialize: (state) => ({
        insights: state.insights,
      }),
      skipHydration: true, // Prevent automatic hydration to avoid SSR mismatch
    },
  ),
);
