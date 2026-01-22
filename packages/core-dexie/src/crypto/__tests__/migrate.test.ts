/**
 * Unit tests for migration utilities
 *
 * Tests cover:
 * - Migration of plaintext API keys to encrypted format
 * - Idempotent behavior (skip already encrypted values)
 * - Mixed scenarios (some encrypted, some plaintext)
 * - Empty and undefined field handling
 * - Migration result counts
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db";
import type { DataSourceEntity } from "../../db/schema";
import { deriveKey, encrypt, generateSalt } from "../index";
import { migrateToEncryption } from "../migrate";

describe("migration utilities", () => {
  let testKey: CryptoKey;

  beforeEach(async () => {
    // Clear all tables before each test
    await db.dataSources.clear();
    await db.settings.clear();

    // Generate a test encryption key
    const salt = generateSalt();
    testKey = await deriveKey("test-passphrase", salt);
  });

  describe("migrateToEncryption", () => {
    it("should encrypt plaintext apiKey values", async () => {
      // Create data source with plaintext apiKey
      const dataSource: DataSourceEntity = {
        id: crypto.randomUUID(),
        type: "notion",
        name: "Test Notion",
        apiKey: "secret_plaintext_api_key",
        createdAt: Date.now(),
      };
      await db.dataSources.add(dataSource);

      // Run migration
      const result = await migrateToEncryption(testKey);

      // Verify migration results
      expect(result.total).toBe(1);
      expect(result.encrypted).toBe(1);
      expect(result.skipped).toBe(0);

      // Verify the apiKey is now encrypted (base64-encoded)
      const updated = await db.dataSources.get(dataSource.id);
      expect(updated).toBeDefined();
      expect(updated!.apiKey).not.toBe("secret_plaintext_api_key");
      expect(updated!.apiKey).toMatch(/^[A-Za-z0-9+/]+=*$/); // Base64 pattern
    });

    it("should encrypt plaintext connectionString values", async () => {
      // Create data source with plaintext connectionString
      const dataSource: DataSourceEntity = {
        id: crypto.randomUUID(),
        type: "postgres",
        name: "Test DB",
        connectionString: "postgresql://user:pass@localhost:5432/db",
        createdAt: Date.now(),
      };
      await db.dataSources.add(dataSource);

      // Run migration
      const result = await migrateToEncryption(testKey);

      // Verify migration results
      expect(result.total).toBe(1);
      expect(result.encrypted).toBe(1);
      expect(result.skipped).toBe(0);

      // Verify the connectionString is now encrypted
      const updated = await db.dataSources.get(dataSource.id);
      expect(updated).toBeDefined();
      expect(updated!.connectionString).not.toBe(
        "postgresql://user:pass@localhost:5432/db",
      );
      expect(updated!.connectionString).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it("should skip already encrypted values (idempotent)", async () => {
      // Create data source with already encrypted apiKey
      const plaintext = "secret_api_key";
      const encrypted = await encrypt(plaintext, testKey);

      const dataSource: DataSourceEntity = {
        id: crypto.randomUUID(),
        type: "notion",
        name: "Test Notion",
        apiKey: encrypted,
        createdAt: Date.now(),
      };
      await db.dataSources.add(dataSource);

      // Run migration
      const result = await migrateToEncryption(testKey);

      // Verify migration skipped the already encrypted value
      expect(result.total).toBe(1);
      expect(result.encrypted).toBe(0);
      expect(result.skipped).toBe(1);

      // Verify the apiKey remains unchanged
      const updated = await db.dataSources.get(dataSource.id);
      expect(updated).toBeDefined();
      expect(updated!.apiKey).toBe(encrypted);
    });

    it("should handle mixed plaintext and encrypted values", async () => {
      // Create one with plaintext apiKey
      const plaintext1: DataSourceEntity = {
        id: crypto.randomUUID(),
        type: "notion",
        name: "Plaintext Source",
        apiKey: "plaintext_key_123",
        createdAt: Date.now(),
      };

      // Create one with already encrypted apiKey
      const encrypted = await encrypt("already_encrypted_key", testKey);
      const encrypted1: DataSourceEntity = {
        id: crypto.randomUUID(),
        type: "notion",
        name: "Encrypted Source",
        apiKey: encrypted,
        createdAt: Date.now(),
      };

      // Create one without apiKey
      const noKey: DataSourceEntity = {
        id: crypto.randomUUID(),
        type: "csv",
        name: "CSV Source",
        createdAt: Date.now(),
      };

      await db.dataSources.bulkAdd([plaintext1, encrypted1, noKey]);

      // Run migration
      const result = await migrateToEncryption(testKey);

      // Verify migration results
      expect(result.total).toBe(3);
      expect(result.encrypted).toBe(1); // Only plaintext1
      expect(result.skipped).toBe(1); // Only encrypted1

      // Verify plaintext was encrypted
      const updated1 = await db.dataSources.get(plaintext1.id);
      expect(updated1!.apiKey).not.toBe("plaintext_key_123");
      expect(updated1!.apiKey).toMatch(/^[A-Za-z0-9+/]+=*$/);

      // Verify encrypted remained unchanged
      const updated2 = await db.dataSources.get(encrypted1.id);
      expect(updated2!.apiKey).toBe(encrypted);

      // Verify source without key remains unchanged
      const updated3 = await db.dataSources.get(noKey.id);
      expect(updated3!.apiKey).toBeUndefined();
    });

    it("should handle empty and whitespace values gracefully", async () => {
      // Create data sources with empty/whitespace values
      const empty: DataSourceEntity = {
        id: crypto.randomUUID(),
        type: "notion",
        name: "Empty Key",
        apiKey: "",
        createdAt: Date.now(),
      };

      const whitespace: DataSourceEntity = {
        id: crypto.randomUUID(),
        type: "notion",
        name: "Whitespace Key",
        apiKey: "   ",
        createdAt: Date.now(),
      };

      await db.dataSources.bulkAdd([empty, whitespace]);

      // Run migration
      const result = await migrateToEncryption(testKey);

      // Verify migration skipped empty/whitespace values
      expect(result.total).toBe(2);
      expect(result.encrypted).toBe(0);
      expect(result.skipped).toBe(0);

      // Verify values remain unchanged
      const updated1 = await db.dataSources.get(empty.id);
      expect(updated1!.apiKey).toBe("");

      const updated2 = await db.dataSources.get(whitespace.id);
      expect(updated2!.apiKey).toBe("   ");
    });

    it("should handle data source with both apiKey and connectionString", async () => {
      // Create data source with both fields as plaintext
      const dataSource: DataSourceEntity = {
        id: crypto.randomUUID(),
        type: "postgres",
        name: "Test DB",
        apiKey: "api_key_123",
        connectionString: "postgresql://localhost:5432/db",
        createdAt: Date.now(),
      };
      await db.dataSources.add(dataSource);

      // Run migration
      const result = await migrateToEncryption(testKey);

      // Verify both fields were encrypted
      expect(result.total).toBe(1);
      expect(result.encrypted).toBe(1); // Count once per data source

      const updated = await db.dataSources.get(dataSource.id);
      expect(updated).toBeDefined();
      expect(updated!.apiKey).not.toBe("api_key_123");
      expect(updated!.apiKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(updated!.connectionString).not.toBe(
        "postgresql://localhost:5432/db",
      );
      expect(updated!.connectionString).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it("should be truly idempotent - running twice doesn't double-encrypt", async () => {
      // Create data source with plaintext apiKey
      const dataSource: DataSourceEntity = {
        id: crypto.randomUUID(),
        type: "notion",
        name: "Test Notion",
        apiKey: "secret_api_key",
        createdAt: Date.now(),
      };
      await db.dataSources.add(dataSource);

      // Run migration first time
      const result1 = await migrateToEncryption(testKey);
      expect(result1.encrypted).toBe(1);

      // Get the encrypted value
      const afterFirst = await db.dataSources.get(dataSource.id);
      const encryptedValue = afterFirst!.apiKey;

      // Run migration second time
      const result2 = await migrateToEncryption(testKey);

      // Verify second run skipped the already encrypted value
      expect(result2.total).toBe(1);
      expect(result2.encrypted).toBe(0);
      expect(result2.skipped).toBe(1);

      // Verify the value wasn't double-encrypted
      const afterSecond = await db.dataSources.get(dataSource.id);
      expect(afterSecond!.apiKey).toBe(encryptedValue);
    });

    it("should handle special characters and unicode in plaintext", async () => {
      // Create data sources with special characters
      const special: DataSourceEntity = {
        id: crypto.randomUUID(),
        type: "notion",
        name: "Special Chars",
        apiKey: "key!@#$%^&*()_+-={}[]|:;<>?,./",
        createdAt: Date.now(),
      };

      const unicode: DataSourceEntity = {
        id: crypto.randomUUID(),
        type: "notion",
        name: "Unicode",
        apiKey: "密钥🔑key🚀test",
        createdAt: Date.now(),
      };

      await db.dataSources.bulkAdd([special, unicode]);

      // Run migration
      const result = await migrateToEncryption(testKey);

      // Verify migration encrypted both
      expect(result.total).toBe(2);
      expect(result.encrypted).toBe(2);

      // Verify values are encrypted (base64)
      const updated1 = await db.dataSources.get(special.id);
      expect(updated1!.apiKey).toMatch(/^[A-Za-z0-9+/]+=*$/);

      const updated2 = await db.dataSources.get(unicode.id);
      expect(updated2!.apiKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it("should return zero counts for empty database", async () => {
      // Run migration on empty database
      const result = await migrateToEncryption(testKey);

      // Verify counts are all zero
      expect(result.total).toBe(0);
      expect(result.encrypted).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("should correctly count when only connectionString needs encryption", async () => {
      // Create data source with encrypted apiKey but plaintext connectionString
      const encryptedApiKey = await encrypt("api_key", testKey);
      const dataSource: DataSourceEntity = {
        id: crypto.randomUUID(),
        type: "postgres",
        name: "Mixed Encryption",
        apiKey: encryptedApiKey,
        connectionString: "postgresql://localhost:5432/db",
        createdAt: Date.now(),
      };
      await db.dataSources.add(dataSource);

      // Run migration
      const result = await migrateToEncryption(testKey);

      // Verify counts (apiKey skipped, connectionString encrypted)
      expect(result.total).toBe(1);
      expect(result.encrypted).toBe(1);
      expect(result.skipped).toBe(1);

      // Verify connectionString was encrypted
      const updated = await db.dataSources.get(dataSource.id);
      expect(updated!.connectionString).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });
  });
});
