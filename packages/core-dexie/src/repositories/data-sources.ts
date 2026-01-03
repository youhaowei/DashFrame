import type {
  CreateDataSourceInput,
  DataSource,
  DataSourceMutations,
  UseDataSourcesResult,
  UUID,
} from "@dashframe/types";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db, type DataSourceEntity } from "../db";

// ============================================================================
// Entity to Domain Conversion
// ============================================================================

/**
 * Convert Dexie entity to domain DataSource.
 * Simple pass-through since schema is now generic.
 */
function entityToDataSource(entity: DataSourceEntity): DataSource {
  return {
    id: entity.id,
    type: entity.type,
    name: entity.name,
    apiKey: entity.apiKey,
    connectionString: entity.connectionString,
    createdAt: entity.createdAt,
  };
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to read all data sources.
 * Returns reactive data that updates when IndexedDB changes.
 */
export function useDataSources(): UseDataSourcesResult {
  const data = useLiveQuery(async () => {
    const entities = await db.dataSources.toArray();
    return entities.map(entityToDataSource);
  });

  return {
    data,
    isLoading: data === undefined,
  };
}

/**
 * Hook to get data source mutations.
 * Pure CRUD operations - connector-specific logic handled at UI layer.
 */
export function useDataSourceMutations(): DataSourceMutations {
  return useMemo(
    () => ({
      add: async (input: CreateDataSourceInput): Promise<UUID> => {
        const id = crypto.randomUUID();
        await db.dataSources.add({
          id,
          type: input.type,
          name: input.name,
          apiKey: input.apiKey,
          connectionString: input.connectionString,
          createdAt: Date.now(),
        });
        return id;
      },

      update: async (
        id: UUID,
        updates: Partial<
          Pick<DataSource, "name" | "apiKey" | "connectionString">
        >,
      ): Promise<void> => {
        await db.dataSources.update(id, updates);
      },

      remove: async (id: UUID): Promise<void> => {
        // Also delete related data tables
        await db.dataTables.where("dataSourceId").equals(id).delete();
        await db.dataSources.delete(id);
      },
    }),
    [],
  );
}

// ============================================================================
// Direct Access Functions (for non-React contexts)
// ============================================================================

export async function getDataSource(id: UUID): Promise<DataSource | undefined> {
  const entity = await db.dataSources.get(id);
  return entity ? entityToDataSource(entity) : undefined;
}

export async function getDataSourceByType(
  type: string,
): Promise<DataSource | null> {
  const entity = await db.dataSources.where("type").equals(type).first();
  return entity ? entityToDataSource(entity) : null;
}

export async function getAllDataSources(): Promise<DataSource[]> {
  const entities = await db.dataSources.toArray();
  return entities.map(entityToDataSource);
}
