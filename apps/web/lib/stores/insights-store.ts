import "./config";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UUID } from "@dash-frame/dataframe";
import type { Insight, InsightExecutionType } from "./types";

// ============================================================================
// State Interface
// ============================================================================

interface InsightsState {
  insights: Map<UUID, Insight>;
}

interface InsightsActions {
  // Create Insight
  addInsight: (
    name: string,
    dataTableIds: UUID[],
    executionType: InsightExecutionType,
    config?: unknown,
  ) => UUID;

  // Update Insight
  updateInsight: (
    insightId: UUID,
    updates: Partial<Omit<Insight, "id" | "createdAt">>,
  ) => void;

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
      return Array.from(value.entries()).map(([_id, insight]) => insight);
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

      // Add new Insight
      addInsight: (name, dataTableIds, executionType, config) => {
        const id = crypto.randomUUID();
        const now = Date.now();

        const insight: Insight = {
          id,
          name,
          dataTableIds,
          executionType,
          config,
          createdAt: now,
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
        return allInsights.filter((insight) =>
          insight.dataTableIds.includes(dataTableId),
        );
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
      name: "dash-frame:insights",
      storage,
      partialize: (state) => ({
        insights: state.insights,
      }),
    },
  ),
);
