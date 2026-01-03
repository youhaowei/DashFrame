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
import {
  encryptSensitiveFields,
  decryptSensitiveFields,
} from "../crypto/field-encryption";

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
async function entityToDataSource(entity: DataSourceEntity): Promise<DataSource> {
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
      add: async (input: CreateDataSourceInput): Promise<UUID> => {
        const id = crypto.randomUUID();

        // Create entity with plaintext values
        const entity: DataSourceEntity = {
          id,
          type: input.type,
          name: input.name,
          apiKey: input.apiKey,
          connectionString: input.connectionString,
          createdAt: Date.now(),
        };

        // Encrypt sensitive fields before storage
        // This will throw if encryption key is not unlocked
        const encrypted = await encryptSensitiveFields(entity);

        await db.dataSources.add(encrypted);
        return id;
      },

      update: async (
        id: UUID,
        updates: Partial<
          Pick<DataSource, "name" | "apiKey" | "connectionString">
        >,
      ): Promise<void> => {
        // If sensitive fields are being updated, encrypt them
        if (updates.apiKey !== undefined || updates.connectionString !== undefined) {
          // Get current entity to preserve non-updated fields
          const current = await db.dataSources.get(id);
          if (!current) {
            throw new Error(`DataSource with id ${id} not found`);
          }

          // Create entity with updated values
          const updated: DataSourceEntity = {
            ...current,
            ...updates,
          };

          // Encrypt sensitive fields
          // This will throw if encryption key is not unlocked
          const encrypted = await encryptSensitiveFields(updated);

          // Update only the fields that were provided
          const encryptedUpdates: Partial<DataSourceEntity> = {};
          if (updates.name !== undefined) encryptedUpdates.name = encrypted.name;
          if (updates.apiKey !== undefined) encryptedUpdates.apiKey = encrypted.apiKey;
          if (updates.connectionString !== undefined) {
            encryptedUpdates.connectionString = encrypted.connectionString;
          }

          await db.dataSources.update(id, encryptedUpdates);
        } else {
          // No sensitive fields to encrypt, just update
          await db.dataSources.update(id, updates);
        }
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
