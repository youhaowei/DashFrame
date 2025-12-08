"use client";

import "./config";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UUID, Field, Metric, SourceSchema } from "@dashframe/dataframe";
import type {
  DataSource,
  LocalDataSource,
  NotionDataSource,
  DataTable,
} from "./types";
import { isNotionDataSource, isLocalDataSource } from "./types";
import { superjsonStorage } from "./storage";

// ============================================================================
// State Interface
// ============================================================================

interface DataSourcesState {
  dataSources: Map<UUID, DataSource>;
  _cachedDataSources: DataSource[]; // Cached array for stable references
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
    options?: {
      id?: UUID;
      sourceSchema?: SourceSchema;
      fields?: Field[];
      metrics?: Metric[];
      dataFrameId?: UUID;
    },
  ) => UUID;
  updateDataTable: (
    dataSourceId: UUID,
    dataTableId: UUID,
    updates: Partial<Omit<DataTable, "id" | "createdAt" | "dataSourceId">>,
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

  // Field Management
  addField: (dataSourceId: UUID, dataTableId: UUID, field: Field) => void;
  updateField: (
    dataSourceId: UUID,
    dataTableId: UUID,
    fieldId: UUID,
    updates: Partial<Field>,
  ) => void;
  deleteField: (dataSourceId: UUID, dataTableId: UUID, fieldId: UUID) => void;

  // Metric Management
  addMetric: (dataSourceId: UUID, dataTableId: UUID, metric: Metric) => void;
  updateMetric: (
    dataSourceId: UUID,
    dataTableId: UUID,
    metricId: UUID,
    updates: Partial<Metric>,
  ) => void;
  deleteMetric: (dataSourceId: UUID, dataTableId: UUID, metricId: UUID) => void;

  // Schema sync
  updateSourceSchema: (
    dataSourceId: UUID,
    dataTableId: UUID,
    sourceSchema: SourceSchema,
  ) => void;

  // General
  update: (id: UUID, updates: Partial<DataSource>) => void;
  remove: (id: UUID) => void;
  get: (id: UUID) => DataSource | undefined;
  getAll: () => DataSource[];
  clear: () => void;
}

type DataSourcesStore = DataSourcesState & DataSourcesActions;

// Helper: rebuild cached sources with cloned tables to avoid immer proxies leaking
const rebuildCache = (state: DataSourcesState) => {
  state._cachedDataSources = Array.from(state.dataSources.values()).map(
    (source) => {
      const clonedTables = new Map(
        Array.from(source.dataTables.entries()).map(([id, table]) => [
          id,
          {
            ...table,
            fields: [...(table.fields ?? [])],
            metrics: [...(table.metrics ?? [])],
          },
        ]),
      );

      return {
        ...source,
        dataTables: clonedTables,
      };
    },
  );
};

// ============================================================================
// Store Implementation
// ============================================================================

export const useDataSourcesStore = create<DataSourcesStore>()(
  persist(
    immer((set, get) => ({
      // Initial state
      dataSources: new Map(),
      _cachedDataSources: [],

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
          rebuildCache(state);
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
              rebuildCache(state);
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
          rebuildCache(state);
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
      addDataTable: (dataSourceId, name, table, options = {}) => {
        const dataSource = get().dataSources.get(dataSourceId);

        if (!dataSource) {
          throw new Error(`Data source ${dataSourceId} not found`);
        }

        const dataTableId = options.id ?? crypto.randomUUID();

        // Auto-generate default count metric
        const defaultMetrics: Metric[] = [
          {
            id: crypto.randomUUID(),
            name: "Count",
            tableId: dataTableId,
            columnName: undefined, // Count all rows
            aggregation: "count",
          },
        ];

        const dataTable: DataTable = {
          id: dataTableId,
          name,
          dataSourceId,
          table,
          sourceSchema: options.sourceSchema,
          fields: options.fields ?? [],
          metrics: [...defaultMetrics, ...(options.metrics ?? [])],
          dataFrameId: options.dataFrameId,
          createdAt: Date.now(),
        };

        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source) {
            source.dataTables.set(dataTableId, dataTable);
            rebuildCache(state);
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
              rebuildCache(state);
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
              rebuildCache(state);
            }
          }
        });
      },

      removeDataTable: (dataSourceId, dataTableId) => {
        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source) {
            source.dataTables.delete(dataTableId);
            rebuildCache(state);
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
            rebuildCache(state);
          }
        });
      },

      remove: (id) => {
        set((state) => {
          state.dataSources.delete(id);
          rebuildCache(state);
        });
      },

      get: (id) => {
        return get().dataSources.get(id);
      },

      getAll: () => {
        return get()._cachedDataSources;
      },

      clear: () => {
        set((state) => {
          state.dataSources.clear();
          rebuildCache(state);
        });
      },

      // Field Management
      addField: (dataSourceId, dataTableId, field) => {
        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source) {
            const dataTable = source.dataTables.get(dataTableId);
            if (dataTable) {
              dataTable.fields.push(field);
              rebuildCache(state);
            }
          }
        });
      },

      updateField: (dataSourceId, dataTableId, fieldId, updates) => {
        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source) {
            const dataTable = source.dataTables.get(dataTableId);
            if (dataTable) {
              const field = dataTable.fields.find((f) => f.id === fieldId);
              if (field) {
                Object.assign(field, updates);
                rebuildCache(state);
              }
            }
          }
        });
      },

      deleteField: (dataSourceId, dataTableId, fieldId) => {
        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source) {
            const dataTable = source.dataTables.get(dataTableId);
            if (dataTable) {
              dataTable.fields = dataTable.fields.filter(
                (f) => f.id !== fieldId,
              );
              rebuildCache(state);
            }
          }
        });
      },

      // Metric Management
      addMetric: (dataSourceId, dataTableId, metric) => {
        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source) {
            const dataTable = source.dataTables.get(dataTableId);
            if (dataTable) {
              dataTable.metrics.push(metric);
              rebuildCache(state);
            }
          }
        });
      },

      updateMetric: (dataSourceId, dataTableId, metricId, updates) => {
        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source) {
            const dataTable = source.dataTables.get(dataTableId);
            if (dataTable) {
              const metric = dataTable.metrics.find((m) => m.id === metricId);
              if (metric) {
                Object.assign(metric, updates);
                rebuildCache(state);
              }
            }
          }
        });
      },

      deleteMetric: (dataSourceId, dataTableId, metricId) => {
        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source) {
            const dataTable = source.dataTables.get(dataTableId);
            if (dataTable) {
              dataTable.metrics = dataTable.metrics.filter(
                (m) => m.id !== metricId,
              );
              rebuildCache(state);
            }
          }
        });
      },

      // Schema sync
      updateSourceSchema: (dataSourceId, dataTableId, sourceSchema) => {
        set((state) => {
          const source = state.dataSources.get(dataSourceId);
          if (source) {
            const dataTable = source.dataTables.get(dataTableId);
            if (dataTable) {
              dataTable.sourceSchema = sourceSchema;
              rebuildCache(state);
            }
          }
        });
      },
    })),
    {
      name: "dashframe:data-sources",
      storage: superjsonStorage,
      partialize: (state) => ({
        dataSources: state.dataSources,
      }),
      skipHydration: true,
    },
  ),
);
