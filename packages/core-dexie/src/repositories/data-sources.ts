import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import type {
  UUID,
  DataSource,
  LocalDataSource,
  NotionDataSource,
  UseDataSourcesResult,
  DataSourceMutations,
} from "@dashframe/core";
import { db, type DataSourceEntity } from "../db";

// ============================================================================
// Entity to Domain Conversion
// ============================================================================

function entityToDataSource(entity: DataSourceEntity): DataSource {
  if (entity.type === "notion") {
    return {
      id: entity.id,
      type: "notion",
      name: entity.name,
      apiKey: entity.apiKey!,
      createdAt: entity.createdAt,
    } as NotionDataSource;
  }
  return {
    id: entity.id,
    type: "local",
    name: entity.name,
    createdAt: entity.createdAt,
  } as LocalDataSource;
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
 * Returns stable mutation functions.
 */
export function useDataSourceMutations(): DataSourceMutations {
  return useMemo(
    () => ({
      addLocal: async (name: string): Promise<UUID> => {
        const id = crypto.randomUUID();
        await db.dataSources.add({
          id,
          type: "local",
          name,
          createdAt: Date.now(),
        });
        return id;
      },

      setNotion: async (name: string, apiKey: string): Promise<UUID> => {
        // Check if Notion connection already exists
        const existing = await db.dataSources
          .where("type")
          .equals("notion")
          .first();

        if (existing) {
          // Update existing
          await db.dataSources.update(existing.id, { name, apiKey });
          return existing.id;
        }

        // Create new
        const id = crypto.randomUUID();
        await db.dataSources.add({
          id,
          type: "notion",
          name,
          apiKey,
          createdAt: Date.now(),
        });
        return id;
      },

      remove: async (id: UUID): Promise<void> => {
        // Also delete related data tables
        await db.dataTables.where("dataSourceId").equals(id).delete();
        await db.dataSources.delete(id);
      },

      clearNotion: async (): Promise<void> => {
        const notion = await db.dataSources
          .where("type")
          .equals("notion")
          .first();
        if (notion) {
          await db.dataTables.where("dataSourceId").equals(notion.id).delete();
          await db.dataSources.delete(notion.id);
        }
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

export async function getLocalDataSource(): Promise<LocalDataSource | null> {
  const entity = await db.dataSources.where("type").equals("local").first();
  return entity ? (entityToDataSource(entity) as LocalDataSource) : null;
}

export async function getNotionDataSource(): Promise<NotionDataSource | null> {
  const entity = await db.dataSources.where("type").equals("notion").first();
  return entity ? (entityToDataSource(entity) as NotionDataSource) : null;
}

export async function getAllDataSources(): Promise<DataSource[]> {
  const entities = await db.dataSources.toArray();
  return entities.map(entityToDataSource);
}
