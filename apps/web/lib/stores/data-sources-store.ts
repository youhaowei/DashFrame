import "./config";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UUID } from "@dash-frame/dataframe";
import type {
  DataSource,
  LocalDataSource,
  NotionDataSource,
  DataTable,
} from "./types";
import { isNotionDataSource, isLocalDataSource } from "./types";

// ============================================================================
// State Interface
// ============================================================================

interface DataSourcesState {
  dataSources: Map<UUID, DataSource>;
}

interface DataSourcesActions {
  // Local Data Source (CSV uploads, local files)
  addLocal: (name: string) => UUID;
  getLocal: () => LocalDataSource | null;

  // Notion Data Source (single connection for now)
  setNotion: (name: string, apiKey: string) => UUID;
  getNotion: () => NotionDataSource | null;
  clearNotion: () => void;

  // DataTable Management (works for all source types)
  addDataTable: (
    dataSourceId: UUID,
    name: string,
    table: string,
    dimensions: string[],
    dataFrameId?: UUID,
  ) => UUID;
  updateDataTable: (
    dataSourceId: UUID,
    dataTableId: UUID,
    updates: Partial<Omit<DataTable, "id" | "createdAt" | "sourceId">>,
  ) => void;
  refreshDataTable: (
    dataSourceId: UUID,
    dataTableId: UUID,
    dataFrameId: UUID,
  ) => void;
  removeDataTable: (dataSourceId: UUID, dataTableId: UUID) => void;
  getDataTable: (
    dataSourceId: UUID,
    dataTableId: UUID,
  ) => DataTable | undefined;
  getDataTablesBySource: (dataSourceId: UUID) => DataTable[];

  // General
  update: (id: UUID, updates: Partial<DataSource>) => void;
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
            // Always ensure dataTables is initialized as a Map
            let dataTables: Map<UUID, DataTable>;

            if ("dataTables" in ds && Array.isArray(ds.dataTables)) {
              // Convert dataTables array back to Map
              dataTables = new Map(
                ds.dataTables as unknown as [UUID, DataTable][],
              );
            } else if ("dataTables" in ds && ds.dataTables instanceof Map) {
              // Already a Map (shouldn't happen in serialized data, but handle it)
              dataTables = ds.dataTables;
            } else {
              // Missing or invalid - initialize as empty Map (fixes old localStorage data)
              dataTables = new Map();
            }

            return [
              ds.id,
              {
                ...ds,
                dataTables,
              },
            ];
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
        // Also convert nested dataTables Maps to arrays
        if (
          typeof item === "object" &&
          item !== null &&
          "dataTables" in item &&
          item.dataTables instanceof Map
        ) {
          return {
            ...item,
            dataTables: Array.from(item.dataTables.entries()),
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

      // Local Data Source actions
      addLocal: (name) => {
        const id = crypto.randomUUID();
        const now = Date.now();

        const localSource: LocalDataSource = {
          id,
          type: "local",
          name,
          dataTables: new Map(),
          createdAt: now,
        };

        set((state) => {
          state.dataSources.set(id, localSource);
        });

        return id;
      },

      getLocal: () => {
        const sources = Array.from(get().dataSources.values());
        return sources.find(isLocalDataSource) ?? null;
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
          dataTables: new Map(),
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

      // DataTable Management (works for all source types)
      addDataTable: (dataSourceId, name, table, dimensions, dataFrameId) => {
        const dataSource = get().dataSources.get(dataSourceId);

        if (!dataSource) {
          throw new Error(`Data source ${dataSourceId} not found`);
        }

        const dataTableId = crypto.randomUUID();
        const now = Date.now();

        const dataTable: DataTable = {
          id: dataTableId,
          name,
          sourceId: dataSourceId,
          table,
          dimensions,
          dataFrameId,
          createdAt: now,
        };

        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source) {
            source.dataTables.set(dataTableId, dataTable);
          }
        });

        return dataTableId;
      },

      updateDataTable: (dataSourceId, dataTableId, updates) => {
        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source) {
            const dataTable = source.dataTables.get(dataTableId);
            if (dataTable) {
              Object.assign(dataTable, updates);
            }
          }
        });
      },

      refreshDataTable: (dataSourceId, dataTableId, dataFrameId) => {
        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source) {
            const dataTable = source.dataTables.get(dataTableId);
            if (dataTable) {
              dataTable.dataFrameId = dataFrameId;
              dataTable.lastFetchedAt = Date.now();
            }
          }
        });
      },

      removeDataTable: (dataSourceId, dataTableId) => {
        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source) {
            source.dataTables.delete(dataTableId);
          }
        });
      },

      getDataTable: (dataSourceId, dataTableId) => {
        const dataSource = get().dataSources.get(dataSourceId);

        if (!dataSource) {
          return undefined;
        }

        return dataSource.dataTables.get(dataTableId);
      },

      getDataTablesBySource: (dataSourceId) => {
        const dataSource = get().dataSources.get(dataSourceId);

        if (!dataSource) {
          return [];
        }

        return Array.from(dataSource.dataTables.values());
      },

      // General actions
      update: (id, updates) => {
        set((state) => {
          const source = state.dataSources.get(id);
          if (source) {
            Object.assign(source, updates);
          }
        });
      },

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
      skipHydration: true, // Prevent automatic hydration to avoid SSR mismatch
    },
  ),
);
