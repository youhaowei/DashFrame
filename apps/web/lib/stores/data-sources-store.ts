import "./config";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UUID } from "@dash-frame/dataframe";
import type {
  DataSource,
  CSVDataSource,
  NotionDataSource,
  Insight,
} from "./types";
import { isNotionDataSource } from "./types";

// ============================================================================
// State Interface
// ============================================================================

interface DataSourcesState {
  dataSources: Map<UUID, DataSource>;
}

interface DataSourcesActions {
  // CSV Data Source
  addCSV: (
    name: string,
    fileName: string,
    fileSize: number,
    dataFrameId: UUID,
  ) => UUID;
  updateCSVDataFrameId: (id: UUID, dataFrameId: UUID) => void;

  // Notion Data Source (single connection for now)
  setNotion: (name: string, apiKey: string) => UUID;
  getNotion: () => NotionDataSource | null;
  clearNotion: () => void;

  // Insight Management (for Notion DataConnection)
  addInsight: (
    dataSourceId: UUID,
    name: string,
    table: string,
    dimensions: string[],
  ) => UUID;
  updateInsight: (
    dataSourceId: UUID,
    insightId: UUID,
    updates: Partial<Omit<Insight, "id" | "createdAt">>,
  ) => void;
  removeInsight: (dataSourceId: UUID, insightId: UUID) => void;
  getInsight: (dataSourceId: UUID, insightId: UUID) => Insight | undefined;
  getInsightsByDataSource: (dataSourceId: UUID) => Insight[];

  // General
  remove: (id: UUID) => void;
  get: (id: UUID) => DataSource | undefined;
  getAll: () => DataSource[];
  clear: () => void;
}

type DataSourcesStore = DataSourcesState & DataSourcesActions;

// ============================================================================
// Storage Serialization (for Map support)
// ============================================================================

const storage = createJSONStorage<DataSourcesState>(() => localStorage, {
  reviver: (_key, value) => {
    // Convert arrays back to Maps during deserialization
    if (
      value &&
      typeof value === "object" &&
      "dataSources" in value &&
      Array.isArray(value.dataSources)
    ) {
      return {
        ...value,
        dataSources: new Map(
          value.dataSources.map((ds: DataSource) => {
            // Also convert insights arrays back to Maps
            if ("insights" in ds && Array.isArray(ds.insights)) {
              return [
                ds.id,
                {
                  ...ds,
                  insights: new Map(
                    ds.insights as unknown as [UUID, Insight][],
                  ),
                },
              ];
            }
            return [ds.id, ds];
          }),
        ),
      };
    }
    return value;
  },
  replacer: (_key, value) => {
    // Convert Maps to arrays for JSON serialization
    if (value instanceof Map) {
      return Array.from(value.entries()).map(([_id, item]) => {
        // Also convert nested insights Maps to arrays
        if (
          typeof item === "object" &&
          item !== null &&
          "insights" in item &&
          item.insights instanceof Map
        ) {
          return {
            ...item,
            insights: Array.from(item.insights.entries()),
          };
        }
        return item;
      });
    }
    return value;
  },
});

// ============================================================================
// Store Implementation
// ============================================================================

export const useDataSourcesStore = create<DataSourcesStore>()(
  persist(
    immer((set, get) => ({
      // Initial state
      dataSources: new Map(),

      // CSV Data Source actions
      addCSV: (name, fileName, fileSize, dataFrameId) => {
        const id = crypto.randomUUID();
        const now = Date.now();

        const csvSource: CSVDataSource = {
          id,
          type: "csv",
          name,
          fileName,
          fileSize,
          dataFrameId,
          uploadedAt: now,
          createdAt: now,
        };

        set((state) => {
          state.dataSources.set(id, csvSource);
        });

        return id;
      },

      updateCSVDataFrameId: (id, dataFrameId) => {
        set((state) => {
          const source = state.dataSources.get(id);
          if (source && source.type === "csv") {
            source.dataFrameId = dataFrameId;
          }
        });
      },

      // Notion Data Source actions
      setNotion: (name, apiKey) => {
        const existing = get().getNotion();

        if (existing) {
          // Update existing connection
          set((state) => {
            const source = state.dataSources.get(existing.id);
            if (source && isNotionDataSource(source)) {
              source.name = name;
              source.apiKey = apiKey;
            }
          });
          return existing.id;
        }

        // Create new Notion connection
        const id = crypto.randomUUID();
        const now = Date.now();

        const notionSource: NotionDataSource = {
          id,
          type: "notion",
          name,
          apiKey,
          dataFrameId: null,
          insights: new Map(),
          createdAt: now,
        };

        set((state) => {
          state.dataSources.set(id, notionSource);
        });

        return id;
      },

      getNotion: () => {
        const sources = Array.from(get().dataSources.values());
        return sources.find(isNotionDataSource) ?? null;
      },

      clearNotion: () => {
        const notion = get().getNotion();
        if (notion) {
          get().remove(notion.id);
        }
      },

      // Insight Management
      addInsight: (dataSourceId, name, table, dimensions) => {
        const dataSource = get().dataSources.get(dataSourceId);

        if (!dataSource || !isNotionDataSource(dataSource)) {
          throw new Error(
            `Data source ${dataSourceId} is not a Notion connection`,
          );
        }

        const insightId = crypto.randomUUID();
        const now = Date.now();

        const insight: Insight = {
          id: insightId,
          name,
          table,
          dimensions,
          createdAt: now,
        };

        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source && isNotionDataSource(source)) {
            source.insights.set(insightId, insight);
          }
        });

        return insightId;
      },

      updateInsight: (dataSourceId, insightId, updates) => {
        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source && isNotionDataSource(source)) {
            const insight = source.insights.get(insightId);
            if (insight) {
              Object.assign(insight, updates);
            }
          }
        });
      },

      removeInsight: (dataSourceId, insightId) => {
        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source && isNotionDataSource(source)) {
            source.insights.delete(insightId);
          }
        });
      },

      getInsight: (dataSourceId, insightId) => {
        const dataSource = get().dataSources.get(dataSourceId);

        if (!dataSource || !isNotionDataSource(dataSource)) {
          return undefined;
        }

        return dataSource.insights.get(insightId);
      },

      getInsightsByDataSource: (dataSourceId) => {
        const dataSource = get().dataSources.get(dataSourceId);

        if (!dataSource || !isNotionDataSource(dataSource)) {
          return [];
        }

        return Array.from(dataSource.insights.values());
      },

      // General actions
      remove: (id) => {
        set((state) => {
          state.dataSources.delete(id);
        });
      },

      get: (id) => {
        return get().dataSources.get(id);
      },

      getAll: () => {
        return Array.from(get().dataSources.values());
      },

      clear: () => {
        set((state) => {
          state.dataSources.clear();
        });
      },
    })),
    {
      name: "dash-frame:data-sources",
      storage,
      partialize: (state) => ({
        dataSources: state.dataSources,
      }),
    },
  ),
);
