import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import type {
  UUID,
  Field,
  Metric,
  SourceSchema,
  DataTable,
  UseDataTablesResult,
  DataTableMutations,
} from "@dashframe/core";
import { db, type DataTableEntity } from "../db";

// ============================================================================
// Entity to Domain Conversion
// ============================================================================

function entityToDataTable(entity: DataTableEntity): DataTable {
  return {
    id: entity.id,
    name: entity.name,
    dataSourceId: entity.dataSourceId,
    table: entity.table,
    sourceSchema: entity.sourceSchema,
    fields: entity.fields,
    metrics: entity.metrics,
    dataFrameId: entity.dataFrameId,
    createdAt: entity.createdAt,
    lastFetchedAt: entity.lastFetchedAt,
  };
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to read data tables, optionally filtered by data source.
 */
export function useDataTables(dataSourceId?: UUID): UseDataTablesResult {
  const data = useLiveQuery(async () => {
    let entities: DataTableEntity[];
    if (dataSourceId) {
      entities = await db.dataTables
        .where("dataSourceId")
        .equals(dataSourceId)
        .toArray();
    } else {
      entities = await db.dataTables.toArray();
    }
    return entities.map(entityToDataTable);
  }, [dataSourceId]);

  return {
    data,
    isLoading: data === undefined,
  };
}

/**
 * Hook to get data table mutations.
 */
export function useDataTableMutations(): DataTableMutations {
  return useMemo(
    () => ({
      add: async (
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
      ): Promise<UUID> => {
        const id = options?.id ?? crypto.randomUUID();

        // Default count metric
        const defaultMetrics: Metric[] = [
          {
            id: crypto.randomUUID(),
            name: "Count",
            tableId: id,
            columnName: undefined,
            aggregation: "count",
          },
        ];

        await db.dataTables.add({
          id,
          dataSourceId,
          name,
          table,
          sourceSchema: options?.sourceSchema,
          fields: options?.fields ?? [],
          metrics: [...defaultMetrics, ...(options?.metrics ?? [])],
          dataFrameId: options?.dataFrameId,
          createdAt: Date.now(),
        });

        return id;
      },

      update: async (
        id: UUID,
        updates: Partial<Omit<DataTable, "id" | "createdAt" | "dataSourceId">>,
      ): Promise<void> => {
        await db.dataTables.update(id, updates);
      },

      refresh: async (id: UUID, dataFrameId: UUID): Promise<void> => {
        await db.dataTables.update(id, {
          dataFrameId,
          lastFetchedAt: Date.now(),
        });
      },

      remove: async (id: UUID): Promise<void> => {
        await db.dataTables.delete(id);
      },

      addField: async (dataTableId: UUID, field: Field): Promise<void> => {
        const table = await db.dataTables.get(dataTableId);
        if (table) {
          await db.dataTables.update(dataTableId, {
            fields: [...table.fields, field],
          });
        }
      },

      updateField: async (
        dataTableId: UUID,
        fieldId: UUID,
        updates: Partial<Field>,
      ): Promise<void> => {
        const table = await db.dataTables.get(dataTableId);
        if (table) {
          const fields = table.fields.map((f) =>
            f.id === fieldId ? { ...f, ...updates } : f,
          );
          await db.dataTables.update(dataTableId, { fields });
        }
      },

      deleteField: async (dataTableId: UUID, fieldId: UUID): Promise<void> => {
        const table = await db.dataTables.get(dataTableId);
        if (table) {
          const fields = table.fields.filter((f) => f.id !== fieldId);
          await db.dataTables.update(dataTableId, { fields });
        }
      },

      addMetric: async (dataTableId: UUID, metric: Metric): Promise<void> => {
        const table = await db.dataTables.get(dataTableId);
        if (table) {
          await db.dataTables.update(dataTableId, {
            metrics: [...table.metrics, metric],
          });
        }
      },

      updateMetric: async (
        dataTableId: UUID,
        metricId: UUID,
        updates: Partial<Metric>,
      ): Promise<void> => {
        const table = await db.dataTables.get(dataTableId);
        if (table) {
          const metrics = table.metrics.map((m) =>
            m.id === metricId ? { ...m, ...updates } : m,
          );
          await db.dataTables.update(dataTableId, { metrics });
        }
      },

      deleteMetric: async (
        dataTableId: UUID,
        metricId: UUID,
      ): Promise<void> => {
        const table = await db.dataTables.get(dataTableId);
        if (table) {
          const metrics = table.metrics.filter((m) => m.id !== metricId);
          await db.dataTables.update(dataTableId, { metrics });
        }
      },

      updateSourceSchema: async (
        dataTableId: UUID,
        sourceSchema: SourceSchema,
      ): Promise<void> => {
        await db.dataTables.update(dataTableId, { sourceSchema });
      },
    }),
    [],
  );
}

// ============================================================================
// Direct Access Functions
// ============================================================================

export async function getDataTable(id: UUID): Promise<DataTable | undefined> {
  const entity = await db.dataTables.get(id);
  return entity ? entityToDataTable(entity) : undefined;
}

export async function getDataTablesBySource(
  dataSourceId: UUID,
): Promise<DataTable[]> {
  const entities = await db.dataTables
    .where("dataSourceId")
    .equals(dataSourceId)
    .toArray();
  return entities.map(entityToDataTable);
}

export async function getAllDataTables(): Promise<DataTable[]> {
  const entities = await db.dataTables.toArray();
  return entities.map(entityToDataTable);
}
