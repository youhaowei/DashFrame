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
      add: addDataSource,
      update: updateDataSource,
      remove: removeDataSource,
    }),
    [],
  );
}

// ============================================================================
// Direct Access Functions (for non-React contexts)
// ============================================================================

/**
 * Add a new data source.
 *
 * @param input - Data source creation input
 * @returns UUID of the created data source
 */
export async function addDataSource(
  input: CreateDataSourceInput,
): Promise<UUID> {
  const id = crypto.randomUUID();

  const entity: DataSourceEntity = {
    id,
    type: input.type,
    name: input.name,
    apiKey: input.apiKey,
    connectionString: input.connectionString,
    createdAt: Date.now(),
  };

  await db.dataSources.add(entity);
  return id;
}

/**
 * Update an existing data source.
 *
 * @param id - Data source UUID
 * @param updates - Fields to update
 * @throws Error if data source not found
 */
export async function updateDataSource(
  id: UUID,
  updates: Partial<Pick<DataSource, "name" | "apiKey" | "connectionString">>,
): Promise<void> {
  await db.dataSources.update(id, updates);
}

/**
 * Remove a data source and its related data tables.
 *
 * @param id - Data source UUID
 */
export async function removeDataSource(id: UUID): Promise<void> {
  await db.dataTables.where("dataSourceId").equals(id).delete();
  await db.dataSources.delete(id);
}

/**
 * Get a single data source by ID.
 *
 * @param id - DataSource UUID
 * @returns DataSource or undefined if not found
 */
export async function getDataSource(id: UUID): Promise<DataSource | undefined> {
  const entity = await db.dataSources.get(id);
  return entity ? entityToDataSource(entity) : undefined;
}

/**
 * Get a data source by type.
 *
 * @param type - DataSource type (e.g., "notion", "csv")
 * @returns DataSource or null if not found
 */
export async function getDataSourceByType(
  type: string,
): Promise<DataSource | null> {
  const entity = await db.dataSources.where("type").equals(type).first();
  return entity ? entityToDataSource(entity) : null;
}

/**
 * Get all data sources.
 *
 * @returns Array of DataSources
 */
export async function getAllDataSources(): Promise<DataSource[]> {
  const entities = await db.dataSources.toArray();
  return entities.map(entityToDataSource);
}
