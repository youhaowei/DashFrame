import "./config";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UUID, DataTableInfo } from "@dashframe/dataframe";
import { Insight as InsightClass } from "@dashframe/dataframe";
import type { Insight, InsightExecutionType, InsightMetric, DataTable, DataSource } from "./types";

// ============================================================================
// State Interface
// ============================================================================

interface InsightsState {
  insights: Map<UUID, Insight>;
  _cachedInsights: Insight[]; // Cached array for stable references
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

  /**
   * Get an Insight class instance with resolved DataTable objects.
   * This is the preferred method for SQL generation - the returned Insight
   * has all the data needed for toSQL() without store access.
   *
   * @param insightId - The insight ID
   * @param dataSources - Map of all data sources (from useDataSourcesStore)
   * @returns InsightClass instance ready for toSQL(), or null if not found
   */
  getResolvedInsight: (
    insightId: UUID,
    dataSources: Map<UUID, DataSource>,
  ) => InsightClass | null;

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

// Type for what we actually persist (subset of full state)
type PersistedInsightsState = Pick<InsightsState, "insights">;

const storage = createJSONStorage<PersistedInsightsState>(() => localStorage, {
  reviver: (_key, value) => {
    // Convert arrays back to Maps during deserialization
    if (
      value &&
      typeof value === "object" &&
      "insights" in value &&
      Array.isArray(value.insights)
    ) {
      const insightsMap = new Map(value.insights as [UUID, Insight][]);
      return {
        ...value,
        insights: insightsMap,
        _cachedInsights: Array.from(insightsMap.values()), // Recreate cache
      };
    }
    return value;
  },
  replacer: (_key, value) => {
    // Skip cached array (it's derived from the Map)
    if (_key === "_cachedInsights") return undefined;
    // Convert Maps to arrays for JSON serialization
    if (value instanceof Map) {
      return Array.from(value.entries());
    }
    return value;
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate unique name with (N) suffix if duplicates exist
 *
 * @param baseName - The base name to check for duplicates
 * @param existingNames - Set of existing insight names
 * @returns Unique name (e.g., "Sales", "Sales (2)", "Sales (3)")
 */
function generateUniqueName(
  baseName: string,
  existingNames: Set<string>,
): string {
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let counter = 2;
  let candidateName = `${baseName} (${counter})`;

  while (existingNames.has(candidateName)) {
    counter++;
    candidateName = `${baseName} (${counter})`;
  }

  return candidateName;
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useInsightsStore = create<InsightsStore>()(
  persist(
    immer((set, get) => ({
      // Initial state
      insights: new Map(),
      _cachedInsights: [],

      // Create draft Insight (new API)
      createDraft: (tableId, tableName, _fieldIds) => {
        const id = crypto.randomUUID();
        const now = Date.now();

        // Get existing insight names for deduplication
        const existingNames = new Set(
          Array.from(get().insights.values()).map((i) => i.name),
        );
        const uniqueName = generateUniqueName(tableName, existingNames);

        const insight: Insight = {
          id,
          name: uniqueName,
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
          state._cachedInsights = Array.from(state.insights.values());
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
          state._cachedInsights = Array.from(state.insights.values());
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
          console.error(
            `Cannot merge: original insight ${originalId} not found`,
          );
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
          state._cachedInsights = Array.from(state.insights.values());
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
          state._cachedInsights = Array.from(state.insights.values());
        });
      },

      // Get single Insight
      getInsight: (insightId) => {
        return get().insights.get(insightId);
      },

      // Get Insight class with resolved DataTable objects
      getResolvedInsight: (insightId, dataSources) => {
        const storeInsight = get().insights.get(insightId);
        if (!storeInsight) return null;

        // Helper to find DataTable by ID across all data sources
        const findDataTable = (tableId: UUID): DataTable | null => {
          for (const ds of dataSources.values()) {
            const table = ds.dataTables.get(tableId);
            if (table) return table;
          }
          return null;
        };

        // Helper to convert store DataTable to DataTableInfo
        const toDataTableInfo = (table: DataTable): DataTableInfo => ({
          id: table.id,
          name: table.name,
          dataFrameId: table.dataFrameId,
          fields: table.fields.map((f) => ({
            id: f.id,
            name: f.name,
            columnName: f.columnName,
            type: f.type,
          })),
        });

        // Resolve base table
        const baseTable = findDataTable(storeInsight.baseTable.tableId);
        if (!baseTable) {
          console.error(`[getResolvedInsight] Base table not found: ${storeInsight.baseTable.tableId}`);
          return null;
        }

        // Resolve joins (if any)
        const resolvedJoins = (storeInsight.joins ?? []).map((join) => {
          const joinTable = findDataTable(join.tableId);
          if (!joinTable) {
            throw new Error(`Join table not found: ${join.tableId}`);
          }
          return {
            table: toDataTableInfo(joinTable),
            selectedFields: join.selectedFields,
            joinOn: join.joinOn,
            joinType: join.joinType,
          };
        });

        // Create and return InsightClass with resolved DataTable objects
        return new InsightClass({
          id: storeInsight.id,
          name: storeInsight.name,
          baseTable: toDataTableInfo(baseTable),
          selectedFields: storeInsight.baseTable.selectedFields,
          metrics: storeInsight.metrics,
          joins: resolvedJoins,
          // Note: Store's filters have different shape, convert if needed
          filters: [],
        });
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

      // Get all Insights (returns cached array for stable references)
      getAll: () => {
        return get()._cachedInsights;
      },

      // Clear all
      clear: () => {
        set((state) => {
          state.insights.clear();
          state._cachedInsights = [];
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
