import "./config";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UUID, DataFrame, EnhancedDataFrame } from "@dashframe/dataframe";

// ============================================================================
// State Interface
// ============================================================================

interface DataFramesState {
  dataFrames: Map<UUID, EnhancedDataFrame>;
  _cachedDataFrames: EnhancedDataFrame[]; // Cached array for stable references
}

interface DataFramesActions {
  // Create from CSV DataSource
  createFromCSV: (dataSourceId: UUID, name: string, data: DataFrame) => UUID;

  // Create/update from Insight
  createFromInsight: (insightId: UUID, name: string, data: DataFrame) => UUID;
  updateFromInsight: (insightId: UUID, data: DataFrame) => void;
  updateById: (id: UUID, data: DataFrame) => void;

  // General
  get: (id: UUID) => EnhancedDataFrame | undefined;
  getByInsight: (insightId: UUID) => EnhancedDataFrame | undefined;
  remove: (id: UUID) => void;
  getAll: () => EnhancedDataFrame[];
  clear: () => void;
}

type DataFramesStore = DataFramesState & DataFramesActions;

// ============================================================================
// Storage Serialization (for Map support)
// ============================================================================

// Type for what we actually persist (subset of full state)
type PersistedDataFramesState = Pick<DataFramesState, "dataFrames">;

const storage = createJSONStorage<PersistedDataFramesState>(
  () => localStorage,
  {
    reviver: (_key, value: unknown) => {
      // Convert array back to Map during deserialization
      if (
        value &&
        typeof value === "object" &&
        "dataFrames" in value &&
        Array.isArray((value as { dataFrames: unknown }).dataFrames)
      ) {
        const dataFramesMap = new Map(
          (value as { dataFrames: [UUID, EnhancedDataFrame][] }).dataFrames,
        );

        return {
          ...value,
          dataFrames: dataFramesMap,
          _cachedDataFrames: Array.from(dataFramesMap.values()), // Recreate cache
        };
      }
      return value;
    },
    replacer: (_key, value: unknown) => {
      // Skip cached array (it's derived from the Map)
      if (_key === "_cachedDataFrames") return undefined;
      // Convert Map to array for JSON serialization
      if (value instanceof Map) {
        return Array.from(value.entries());
      }
      return value;
    },
  },
);

// ============================================================================
// Store Implementation
// ============================================================================

const calculateColumnCount = (data: DataFrame): number => {
  // Prefer columns count if available (join operations set fieldIds: [] but have columns)
  // Fall back to fieldIds only if columns is not available
  if (data.columns && data.columns.length > 0) {
    return data.columns.length;
  }
  return data.fieldIds?.length ?? 0;
};

const refreshColumnCounts = (state: DataFramesState) => {
  state.dataFrames.forEach((enhanced) => {
    enhanced.metadata.columnCount = calculateColumnCount(enhanced.data);
  });
};

export const useDataFramesStore = create<DataFramesStore>()(
  persist(
    immer((set, get) => ({
      // Initial state
      dataFrames: new Map(),
      _cachedDataFrames: [],

      // Create from CSV
      createFromCSV: (dataSourceId, name, data) => {
        const id = crypto.randomUUID();
        const now = Date.now();

        const enhancedDataFrame: EnhancedDataFrame = {
          metadata: {
            id,
            name,
            source: {
              // No insightId for direct CSV loads (data is already local)
            },
            timestamp: now,
            rowCount: data.rows.length,
            columnCount: calculateColumnCount(data),
          },
          data,
        };

        set((state) => {
          state.dataFrames.set(id, enhancedDataFrame);
          state._cachedDataFrames = Array.from(state.dataFrames.values());
        });

        return id;
      },

      // Create from Insight
      createFromInsight: (insightId, name, data) => {
        const id = crypto.randomUUID();
        const now = Date.now();

        const enhancedDataFrame: EnhancedDataFrame = {
          metadata: {
            id,
            name,
            source: {
              insightId,
            },
            timestamp: now,
            rowCount: data.rows.length,
            columnCount: calculateColumnCount(data),
          },
          data,
        };

        set((state) => {
          state.dataFrames.set(id, enhancedDataFrame);
          state._cachedDataFrames = Array.from(state.dataFrames.values());
        });

        return id;
      },

      // Update from Insight (refresh)
      updateFromInsight: (insightId, data) => {
        // Find existing DataFrame for this insight
        const existing = get().getByInsight(insightId);

        if (existing) {
          // Update existing DataFrame (no cache refresh - Map didn't change)
          set((state) => {
            const df = state.dataFrames.get(existing.metadata.id);
            if (df) {
              df.data = data;
              df.metadata.timestamp = Date.now();
              df.metadata.rowCount = data.rows.length;
              df.metadata.columnCount = calculateColumnCount(data);
            }
          });
        } else {
          // Create new DataFrame if it doesn't exist
          get().createFromInsight(insightId, "Insight Data", data);
        }
      },

      // Update by ID (refresh cached data)
      updateById: (id, data) => {
        // Update doesn't change Map structure, no cache refresh needed
        set((state) => {
          const df = state.dataFrames.get(id);
          if (df) {
            df.data = data;
            df.metadata.timestamp = Date.now();
            df.metadata.rowCount = data.rows.length;
            df.metadata.columnCount = calculateColumnCount(data);
          }
        });
      },

      // Get DataFrame by ID
      get: (id) => {
        return get().dataFrames.get(id);
      },

      // Get DataFrame by Insight
      getByInsight: (insightId) => {
        const dataFrames = Array.from(get().dataFrames.values());
        return dataFrames.find(
          (df) => df.metadata.source.insightId === insightId,
        );
      },

      // Remove DataFrame
      remove: (id) => {
        set((state) => {
          state.dataFrames.delete(id);
          state._cachedDataFrames = Array.from(state.dataFrames.values());
        });
      },

      // Get all DataFrames (returns cached array for stable references)
      getAll: () => {
        return get()._cachedDataFrames;
      },

      // Clear all DataFrames
      clear: () => {
        set((state) => {
          state.dataFrames.clear();
          state._cachedDataFrames = [];
        });
      },
    })),
    {
      name: "dashframe:dataframes",
      storage,
      partialize: (state) => ({
        dataFrames: state.dataFrames,
      }),
      skipHydration: true, // Prevent automatic hydration to avoid SSR mismatch
      onRehydrateStorage: () => {
        return (state) => {
          if (!state) return;
          refreshColumnCounts(state);
        };
      },
    },
  ),
);
