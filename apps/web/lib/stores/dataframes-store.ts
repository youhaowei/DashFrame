import "./config";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UUID, DataFrame, EnhancedDataFrame } from "@dash-frame/dataframe";

// ============================================================================
// State Interface
// ============================================================================

interface DataFramesState {
  dataFrames: Map<UUID, EnhancedDataFrame>;
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

const storage = createJSONStorage<DataFramesState>(() => localStorage, {
  reviver: (_key, value: unknown) => {
    // Convert array back to Map during deserialization
    if (
      value &&
      typeof value === "object" &&
      "dataFrames" in value &&
      Array.isArray((value as { dataFrames: unknown }).dataFrames)
    ) {
      return {
        ...value,
        dataFrames: new Map(
          (value as { dataFrames: [UUID, EnhancedDataFrame][] }).dataFrames,
        ),
      };
    }
    return value;
  },
  replacer: (_key, value: unknown) => {
    // Convert Map to array for JSON serialization
    if (value instanceof Map) {
      return Array.from(value.entries());
    }
    return value;
  },
});

// ============================================================================
// Store Implementation
// ============================================================================

export const useDataFramesStore = create<DataFramesStore>()(
  persist(
    immer((set, get) => ({
      // Initial state
      dataFrames: new Map(),

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
            columnCount: data.columns.length,
          },
          data,
        };

        set((state) => {
          state.dataFrames.set(id, enhancedDataFrame);
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
            columnCount: data.columns.length,
          },
          data,
        };

        set((state) => {
          state.dataFrames.set(id, enhancedDataFrame);
        });

        return id;
      },

      // Update from Insight (refresh)
      updateFromInsight: (insightId, data) => {
        // Find existing DataFrame for this insight
        const existing = get().getByInsight(insightId);

        if (existing) {
          // Update existing DataFrame
          set((state) => {
            const df = state.dataFrames.get(existing.metadata.id);
            if (df) {
              df.data = data;
              df.metadata.timestamp = Date.now();
              df.metadata.rowCount = data.rows.length;
              df.metadata.columnCount = data.columns.length;
            }
          });
        } else {
          // Create new DataFrame if it doesn't exist
          get().createFromInsight(insightId, "Insight Data", data);
        }
      },

      // Update by ID (refresh cached data)
      updateById: (id, data) => {
        set((state) => {
          const df = state.dataFrames.get(id);
          if (df) {
            df.data = data;
            df.metadata.timestamp = Date.now();
            df.metadata.rowCount = data.rows.length;
            df.metadata.columnCount = data.columns.length;
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
        });
      },

      // Get all DataFrames
      getAll: () => {
        return Array.from(get().dataFrames.values());
      },

      // Clear all DataFrames
      clear: () => {
        set((state) => {
          state.dataFrames.clear();
        });
      },
    })),
    {
      name: "dash-frame:dataframes",
      storage,
      partialize: (state) => ({
        dataFrames: state.dataFrames,
      }),
    },
  ),
);
