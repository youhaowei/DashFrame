/**
 * Migration utilities for encrypting existing plaintext sensitive data
 *
 * Provides functions to migrate existing plaintext API keys and connection strings
 * to encrypted format. Migration is idempotent - already encrypted values are skipped.
 */

import { db, type DataSourceEntity } from "../db";
import { encrypt } from "./index";

/**
 * Checks if a value appears to be already encrypted.
 *
 * Encrypted values are base64-encoded and contain:
 * - 12-byte IV
 * - Ciphertext (variable length)
 * - 16-byte authentication tag
 *
 * Minimum encrypted length: 12 + 0 + 16 = 28 bytes (before base64 encoding)
 *
 * @param value - String value to check
 * @returns True if value appears to be encrypted, false if plaintext
 */
function isEncrypted(value: string): boolean {
  // Empty or whitespace values are not encrypted
  if (!value || value.trim().length === 0) {
    return false;
  }

  // Check if value looks like base64
  // Base64 uses A-Z, a-z, 0-9, +, /, and = for padding
  const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
  if (!base64Pattern.test(value)) {
    return false;
  }

  // Try to decode and check length
  try {
    const decoded = atob(value);
    // Minimum encrypted data: 12 (IV) + 16 (auth tag) = 28 bytes
    // Most API keys are much shorter than this when base64-encoded
    return decoded.length >= 28;
  } catch {
    // Not valid base64 - definitely plaintext
    return false;
  }
}

/**
 * Migrates all existing plaintext sensitive data to encrypted format.
 *
 * This function:
 * 1. Reads all DataSource entities from IndexedDB
 * 2. For each entity with apiKey or connectionString:
 *    - Checks if value is already encrypted (base64-encoded with correct format)
 *    - Encrypts plaintext values using the provided key
 *    - Updates the entity in the database
 * 3. Is idempotent - safe to run multiple times (skips already encrypted values)
 *
 * @param key - CryptoKey to use for encryption (from key manager)
 * @returns Migration summary with counts of processed and encrypted values
 * @throws Error if encryption fails
 *
 * @example
 * // After user sets up passphrase for the first time
 * import { getEncryptionKey } from './key-manager';
 * import { migrateToEncryption } from './migrate';
 *
 * const key = getEncryptionKey();
 * const result = await migrateToEncryption(key);
 * console.log(`Encrypted ${result.encrypted} of ${result.total} data sources`);
 */
export async function migrateToEncryption(key: CryptoKey): Promise<{
  total: number;
  encrypted: number;
  skipped: number;
}> {
  // Get all data sources from the database
  const dataSources = await db.dataSources.toArray();

  let encryptedCount = 0;
  let skippedCount = 0;

  // Process each data source
  for (const dataSource of dataSources) {
    let needsUpdate = false;
    const updates: Partial<DataSourceEntity> = {};

    // Check and encrypt apiKey if present and plaintext
    if (dataSource.apiKey && dataSource.apiKey.trim().length > 0) {
      if (isEncrypted(dataSource.apiKey)) {
        skippedCount++;
      } else {
        // Encrypt plaintext apiKey
        updates.apiKey = await encrypt(dataSource.apiKey, key);
        needsUpdate = true;
        encryptedCount++;
      }
    }

    // Check and encrypt connectionString if present and plaintext
    if (
      dataSource.connectionString &&
      dataSource.connectionString.trim().length > 0
    ) {
      if (isEncrypted(dataSource.connectionString)) {
        // Already encrypted, skip
        if (!dataSource.apiKey) {
          // Only count if we haven't already counted for apiKey
          skippedCount++;
        }
      } else {
        // Encrypt plaintext connectionString
        updates.connectionString = await encrypt(
          dataSource.connectionString,
          key,
        );
        needsUpdate = true;
        // Only increment if we haven't already for apiKey
        if (!updates.apiKey) {
          encryptedCount++;
        }
      }
    }

    // Update the database if changes were made
    if (needsUpdate) {
      await db.dataSources.update(dataSource.id, updates);
    }
  }

  return {
    total: dataSources.length,
    encrypted: encryptedCount,
    skipped: skippedCount,
  };
}
