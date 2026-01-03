/**
 * Field-level encryption utilities for DataSource entities
 *
 * Provides functions to encrypt/decrypt sensitive fields (apiKey, connectionString)
 * in DataSource entities before storage and after retrieval.
 */

import { encrypt, decrypt } from "./index";
import { getEncryptionKey } from "./key-manager";
import type { DataSourceEntity } from "../db/schema";

/**
 * Encrypts sensitive fields in a DataSource entity
 *
 * @param entity - DataSource entity to encrypt
 * @returns Cloned entity with encrypted apiKey and connectionString fields
 * @throws Error if encryption key is not unlocked
 *
 * @example
 * const dataSource = {
 *   id: '123',
 *   type: 'notion',
 *   name: 'My Notion',
 *   apiKey: 'secret_abc123',
 *   createdAt: Date.now()
 * };
 * const encrypted = await encryptSensitiveFields(dataSource);
 * // encrypted.apiKey is now base64-encoded ciphertext
 */
export async function encryptSensitiveFields(
  entity: DataSourceEntity
): Promise<DataSourceEntity> {
  // Clone entity to avoid mutation
  const cloned = { ...entity };

  // Get encryption key (throws if not unlocked)
  const key = getEncryptionKey();

  // Encrypt apiKey if present
  if (cloned.apiKey && cloned.apiKey.trim().length > 0) {
    cloned.apiKey = await encrypt(cloned.apiKey, key);
  }

  // Encrypt connectionString if present
  if (cloned.connectionString && cloned.connectionString.trim().length > 0) {
    cloned.connectionString = await encrypt(cloned.connectionString, key);
  }

  return cloned;
}

/**
 * Decrypts sensitive fields in a DataSource entity
 *
 * @param entity - DataSource entity to decrypt
 * @returns Cloned entity with decrypted apiKey and connectionString fields
 * @throws Error if encryption key is not unlocked or decryption fails
 *
 * @example
 * const encrypted = await db.dataSources.get('123');
 * const decrypted = await decryptSensitiveFields(encrypted);
 * // decrypted.apiKey is now the original plaintext
 */
export async function decryptSensitiveFields(
  entity: DataSourceEntity
): Promise<DataSourceEntity> {
  // Clone entity to avoid mutation
  const cloned = { ...entity };

  // Get encryption key (throws if not unlocked)
  const key = getEncryptionKey();

  // Decrypt apiKey if present
  if (cloned.apiKey && cloned.apiKey.trim().length > 0) {
    try {
      cloned.apiKey = await decrypt(cloned.apiKey, key);
    } catch (error) {
      // If decryption fails, the value might already be plaintext (during migration)
      // or the key is wrong. Re-throw with context.
      throw new Error(
        `Failed to decrypt apiKey for data source ${entity.id}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  // Decrypt connectionString if present
  if (cloned.connectionString && cloned.connectionString.trim().length > 0) {
    try {
      cloned.connectionString = await decrypt(cloned.connectionString, key);
    } catch (error) {
      // If decryption fails, the value might already be plaintext (during migration)
      // or the key is wrong. Re-throw with context.
      throw new Error(
        `Failed to decrypt connectionString for data source ${entity.id}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return cloned;
}
