import type {
  CreateDataSourceInput,
  DataSource,
  DataSourceMutations,
  UseDataSourcesResult,
  UUID,
} from "@dashframe/types";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import {
  decryptSensitiveFields,
  encryptSensitiveFields,
} from "../crypto/field-encryption";
import { db, type DataSourceEntity } from "../db";

// ============================================================================
// Entity to Domain Conversion
// ============================================================================

/**
 * Convert Dexie entity to domain DataSource.
 * Decrypts sensitive fields (apiKey, connectionString) before returning.
 *
 * @param entity - DataSource entity from IndexedDB
 * @returns DataSource with decrypted sensitive fields
 * @throws Error if encryption key is not unlocked
 */
async function entityToDataSource(
  entity: DataSourceEntity,
): Promise<DataSource> {
  // Decrypt sensitive fields
  const decrypted = await decryptSensitiveFields(entity);

  return {
    id: decrypted.id,
    type: decrypted.type,
    name: decrypted.name,
    apiKey: decrypted.apiKey,
    connectionString: decrypted.connectionString,
    createdAt: decrypted.createdAt,
  };
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to read all data sources.
 * Returns reactive data that updates when IndexedDB changes.
 * Decrypts sensitive fields before returning.
 */
export function useDataSources(): UseDataSourcesResult {
  const data = useLiveQuery(async () => {
    const entities = await db.dataSources.toArray();
    return Promise.all(entities.map(entityToDataSource));
  });

  return {
    data,
    isLoading: data === undefined,
  };
}

/**
 * Hook to get data source mutations.
 * Pure CRUD operations - connector-specific logic handled at UI layer.
 * Encrypts sensitive fields before storage.
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
 * Encrypts sensitive fields before storage.
 *
 * @param input - Data source creation input
 * @returns UUID of the created data source
 * @throws Error if encryption key is not unlocked
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

  const encrypted = await encryptSensitiveFields(entity);
  await db.dataSources.add(encrypted);
  return id;
}

/**
 * Update an existing data source.
 * Encrypts sensitive fields before storage.
 *
 * @param id - Data source UUID
 * @param updates - Fields to update
 * @throws Error if encryption key is not unlocked or data source not found
 */
export async function updateDataSource(
  id: UUID,
  updates: Partial<Pick<DataSource, "name" | "apiKey" | "connectionString">>,
): Promise<void> {
  if (updates.apiKey !== undefined || updates.connectionString !== undefined) {
    const current = await db.dataSources.get(id);
    if (!current) {
      throw new Error(`DataSource with id ${id} not found`);
    }

    const updated: DataSourceEntity = {
      ...current,
      ...updates,
    };

    const encrypted = await encryptSensitiveFields(updated);

    const encryptedUpdates: Partial<DataSourceEntity> = {};
    if (updates.name !== undefined) encryptedUpdates.name = encrypted.name;
    if (updates.apiKey !== undefined)
      encryptedUpdates.apiKey = encrypted.apiKey;
    if (updates.connectionString !== undefined) {
      encryptedUpdates.connectionString = encrypted.connectionString;
    }

    await db.dataSources.update(id, encryptedUpdates);
  } else {
    await db.dataSources.update(id, updates);
  }
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
 * Decrypts sensitive fields before returning.
 *
 * @param id - DataSource UUID
 * @returns Decrypted DataSource or undefined if not found
 * @throws Error if encryption key is not unlocked
 */
export async function getDataSource(id: UUID): Promise<DataSource | undefined> {
  const entity = await db.dataSources.get(id);
  return entity ? await entityToDataSource(entity) : undefined;
}

/**
 * Get a data source by type.
 * Decrypts sensitive fields before returning.
 *
 * @param type - DataSource type (e.g., "notion", "csv")
 * @returns Decrypted DataSource or null if not found
 * @throws Error if encryption key is not unlocked
 */
export async function getDataSourceByType(
  type: string,
): Promise<DataSource | null> {
  const entity = await db.dataSources.where("type").equals(type).first();
  return entity ? await entityToDataSource(entity) : null;
}

/**
 * Get all data sources.
 * Decrypts sensitive fields before returning.
 *
 * @returns Array of decrypted DataSources
 * @throws Error if encryption key is not unlocked
 */
export async function getAllDataSources(): Promise<DataSource[]> {
  const entities = await db.dataSources.toArray();
  return Promise.all(entities.map(entityToDataSource));
}
