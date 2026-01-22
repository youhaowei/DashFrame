/**
 * Integration tests for repository layer encryption
 *
 * Tests verify that:
 * - add() stores encrypted values (not plaintext) in IndexedDB
 * - read() returns decrypted values
 * - Roundtrip (add then read) returns original
 * - Mutations without unlocked key fail
 */
import type { CreateDataSourceInput } from "@dashframe/types";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  initializeEncryption,
  lockEncryption,
  unlockEncryption,
} from "../../crypto/key-manager";
import { db } from "../../db";
import {
  getAllDataSources,
  getDataSource,
  useDataSourceMutations,
} from "../data-sources";

describe("data-sources repository encryption", () => {
  // Reset database and initialize encryption before each test
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await initializeEncryption("test-passphrase");
  });

  describe("add() with encryption", () => {
    it("should store encrypted apiKey (not plaintext)", async () => {
      const mutations = useDataSourceMutations();
      const plainApiKey = "secret_notion_key_12345";

      const input: CreateDataSourceInput = {
        type: "notion",
        name: "Test Notion",
        apiKey: plainApiKey,
      };

      const id = await mutations.add(input);

      // Read directly from IndexedDB (bypassing decryption)
      const storedEntity = await db.dataSources.get(id);

      // Verify apiKey is encrypted (not plaintext)
      expect(storedEntity?.apiKey).toBeDefined();
      expect(storedEntity?.apiKey).not.toBe(plainApiKey);
      expect(storedEntity?.apiKey?.length).toBeGreaterThan(plainApiKey.length);
    });

    it("should store encrypted connectionString (not plaintext)", async () => {
      const mutations = useDataSourceMutations();
      const plainConnectionString = "postgresql://user:pass@localhost:5432/db";

      const input: CreateDataSourceInput = {
        type: "postgres",
        name: "Test DB",
        connectionString: plainConnectionString,
      };

      const id = await mutations.add(input);

      // Read directly from IndexedDB (bypassing decryption)
      const storedEntity = await db.dataSources.get(id);

      // Verify connectionString is encrypted (not plaintext)
      expect(storedEntity?.connectionString).toBeDefined();
      expect(storedEntity?.connectionString).not.toBe(plainConnectionString);
      expect(storedEntity?.connectionString?.length).toBeGreaterThan(
        plainConnectionString.length,
      );
    });

    it("should store both encrypted fields when both provided", async () => {
      const mutations = useDataSourceMutations();
      const plainApiKey = "sk-api-key-abc";
      const plainConnectionString = "mongodb://localhost:27017/test";

      const input: CreateDataSourceInput = {
        type: "custom",
        name: "Test Custom",
        apiKey: plainApiKey,
        connectionString: plainConnectionString,
      };

      const id = await mutations.add(input);

      // Read directly from IndexedDB (bypassing decryption)
      const storedEntity = await db.dataSources.get(id);

      // Both fields should be encrypted
      expect(storedEntity?.apiKey).not.toBe(plainApiKey);
      expect(storedEntity?.connectionString).not.toBe(plainConnectionString);
    });

    it("should throw error if encryption key is not unlocked", async () => {
      const mutations = useDataSourceMutations();

      // Lock encryption
      lockEncryption();

      const input: CreateDataSourceInput = {
        type: "notion",
        name: "Test Notion",
        apiKey: "secret_key",
      };

      // Should fail because key is locked
      await expect(mutations.add(input)).rejects.toThrow(
        "Encryption is locked",
      );
    });

    it("should handle empty apiKey gracefully", async () => {
      const mutations = useDataSourceMutations();

      const input: CreateDataSourceInput = {
        type: "csv",
        name: "Test CSV",
        // No apiKey provided
      };

      const id = await mutations.add(input);

      // Should succeed without error
      expect(id).toBeDefined();

      const dataSource = await getDataSource(id);
      expect(dataSource?.apiKey).toBeUndefined();
    });

    it("should not encrypt empty string apiKey", async () => {
      const mutations = useDataSourceMutations();

      const input: CreateDataSourceInput = {
        type: "notion",
        name: "Test Notion",
        apiKey: "",
      };

      const id = await mutations.add(input);

      // Read directly from IndexedDB
      const storedEntity = await db.dataSources.get(id);

      // Empty string should remain empty (not encrypted)
      expect(storedEntity?.apiKey).toBe("");
    });
  });

  describe("read() with decryption", () => {
    it("should return decrypted apiKey", async () => {
      const mutations = useDataSourceMutations();
      const plainApiKey = "secret_notion_key_12345";

      const input: CreateDataSourceInput = {
        type: "notion",
        name: "Test Notion",
        apiKey: plainApiKey,
      };

      const id = await mutations.add(input);

      // Read using repository function (should decrypt)
      const dataSource = await getDataSource(id);

      // Should return plaintext apiKey
      expect(dataSource?.apiKey).toBe(plainApiKey);
    });

    it("should return decrypted connectionString", async () => {
      const mutations = useDataSourceMutations();
      const plainConnectionString = "postgresql://user:pass@localhost:5432/db";

      const input: CreateDataSourceInput = {
        type: "postgres",
        name: "Test DB",
        connectionString: plainConnectionString,
      };

      const id = await mutations.add(input);

      // Read using repository function (should decrypt)
      const dataSource = await getDataSource(id);

      // Should return plaintext connectionString
      expect(dataSource?.connectionString).toBe(plainConnectionString);
    });

    it("should decrypt all data sources in getAllDataSources", async () => {
      const mutations = useDataSourceMutations();

      // Add multiple data sources
      const sources = [
        { type: "notion", name: "Notion 1", apiKey: "key1" },
        { type: "notion", name: "Notion 2", apiKey: "key2" },
        { type: "postgres", name: "DB 1", connectionString: "conn1" },
      ];

      for (const source of sources) {
        await mutations.add(source);
      }

      // Get all data sources
      const allSources = await getAllDataSources();

      // All should be decrypted
      expect(allSources).toHaveLength(3);
      expect(allSources[0].apiKey).toBe("key1");
      expect(allSources[1].apiKey).toBe("key2");
      expect(allSources[2].connectionString).toBe("conn1");
    });

    it("should throw error if encryption key is not unlocked during read", async () => {
      const mutations = useDataSourceMutations();

      const input: CreateDataSourceInput = {
        type: "notion",
        name: "Test Notion",
        apiKey: "secret_key",
      };

      const id = await mutations.add(input);

      // Lock encryption
      lockEncryption();

      // Read should fail because key is locked
      await expect(getDataSource(id)).rejects.toThrow("Encryption is locked");
    });
  });

  describe("roundtrip encryption/decryption", () => {
    it("should roundtrip apiKey: add then read returns original", async () => {
      const mutations = useDataSourceMutations();
      const originalApiKey = "sk-original-api-key-12345";

      const input: CreateDataSourceInput = {
        type: "notion",
        name: "Test Notion",
        apiKey: originalApiKey,
      };

      // Add
      const id = await mutations.add(input);

      // Read
      const dataSource = await getDataSource(id);

      // Should get back original plaintext
      expect(dataSource?.apiKey).toBe(originalApiKey);
      expect(dataSource?.name).toBe("Test Notion");
      expect(dataSource?.type).toBe("notion");
    });

    it("should roundtrip connectionString: add then read returns original", async () => {
      const mutations = useDataSourceMutations();
      const originalConnectionString =
        "mongodb://admin:password@localhost:27017/mydb?authSource=admin";

      const input: CreateDataSourceInput = {
        type: "mongodb",
        name: "Test MongoDB",
        connectionString: originalConnectionString,
      };

      // Add
      const id = await mutations.add(input);

      // Read
      const dataSource = await getDataSource(id);

      // Should get back original plaintext
      expect(dataSource?.connectionString).toBe(originalConnectionString);
      expect(dataSource?.name).toBe("Test MongoDB");
    });

    it("should roundtrip both fields when both provided", async () => {
      const mutations = useDataSourceMutations();
      const originalApiKey = "api-key-abc";
      const originalConnectionString = "conn-string-xyz";

      const input: CreateDataSourceInput = {
        type: "custom",
        name: "Test Custom",
        apiKey: originalApiKey,
        connectionString: originalConnectionString,
      };

      // Add
      const id = await mutations.add(input);

      // Read
      const dataSource = await getDataSource(id);

      // Both should be decrypted correctly
      expect(dataSource?.apiKey).toBe(originalApiKey);
      expect(dataSource?.connectionString).toBe(originalConnectionString);
    });

    it("should roundtrip with special characters in apiKey", async () => {
      const mutations = useDataSourceMutations();
      const specialKey = "sk-!@#$%^&*()_+-=[]{}|;:',.<>?/`~";

      const input: CreateDataSourceInput = {
        type: "notion",
        name: "Test",
        apiKey: specialKey,
      };

      const id = await mutations.add(input);
      const dataSource = await getDataSource(id);

      expect(dataSource?.apiKey).toBe(specialKey);
    });

    it("should roundtrip with unicode characters in connectionString", async () => {
      const mutations = useDataSourceMutations();
      const unicodeString = "postgresql://用户:密码@localhost/数据库";

      const input: CreateDataSourceInput = {
        type: "postgres",
        name: "Test",
        connectionString: unicodeString,
      };

      const id = await mutations.add(input);
      const dataSource = await getDataSource(id);

      expect(dataSource?.connectionString).toBe(unicodeString);
    });

    it("should roundtrip very long apiKey", async () => {
      const mutations = useDataSourceMutations();
      const longKey = "sk-" + "a".repeat(1000);

      const input: CreateDataSourceInput = {
        type: "notion",
        name: "Test",
        apiKey: longKey,
      };

      const id = await mutations.add(input);
      const dataSource = await getDataSource(id);

      expect(dataSource?.apiKey).toBe(longKey);
    });
  });

  describe("update() with encryption", () => {
    it("should encrypt new apiKey on update", async () => {
      const mutations = useDataSourceMutations();

      // Add initial data source
      const id = await mutations.add({
        type: "notion",
        name: "Test Notion",
        apiKey: "old-key",
      });

      // Update apiKey
      const newApiKey = "new-secret-key-12345";
      await mutations.update(id, { apiKey: newApiKey });

      // Read directly from IndexedDB (bypassing decryption)
      const storedEntity = await db.dataSources.get(id);

      // Should be encrypted
      expect(storedEntity?.apiKey).not.toBe(newApiKey);
      expect(storedEntity?.apiKey?.length).toBeGreaterThan(newApiKey.length);
    });

    it("should decrypt updated apiKey on read", async () => {
      const mutations = useDataSourceMutations();

      // Add initial data source
      const id = await mutations.add({
        type: "notion",
        name: "Test Notion",
        apiKey: "old-key",
      });

      // Update apiKey
      const newApiKey = "new-secret-key-12345";
      await mutations.update(id, { apiKey: newApiKey });

      // Read using repository function
      const dataSource = await getDataSource(id);

      // Should return decrypted value
      expect(dataSource?.apiKey).toBe(newApiKey);
    });

    it("should encrypt new connectionString on update", async () => {
      const mutations = useDataSourceMutations();

      // Add initial data source
      const id = await mutations.add({
        type: "postgres",
        name: "Test DB",
        connectionString: "old-conn",
      });

      // Update connectionString
      const newConnectionString = "postgresql://new:connection@localhost/db";
      await mutations.update(id, { connectionString: newConnectionString });

      // Read directly from IndexedDB (bypassing decryption)
      const storedEntity = await db.dataSources.get(id);

      // Should be encrypted
      expect(storedEntity?.connectionString).not.toBe(newConnectionString);
      expect(storedEntity?.connectionString?.length).toBeGreaterThan(
        newConnectionString.length,
      );
    });

    it("should throw error if encryption key is not unlocked during update", async () => {
      const mutations = useDataSourceMutations();

      // Add initial data source
      const id = await mutations.add({
        type: "notion",
        name: "Test Notion",
        apiKey: "old-key",
      });

      // Lock encryption
      lockEncryption();

      // Update should fail because key is locked
      await expect(mutations.update(id, { apiKey: "new-key" })).rejects.toThrow(
        "Encryption is locked",
      );
    });

    it("should allow updating non-sensitive fields without encryption key", async () => {
      const mutations = useDataSourceMutations();

      // Add initial data source
      const id = await mutations.add({
        type: "notion",
        name: "Old Name",
        apiKey: "secret-key",
      });

      // Lock encryption
      lockEncryption();

      // Unlock to verify
      await unlockEncryption("test-passphrase");

      // Update non-sensitive field (name only, no apiKey/connectionString)
      await mutations.update(id, { name: "New Name" });

      // Should succeed
      const dataSource = await getDataSource(id);
      expect(dataSource?.name).toBe("New Name");
    });
  });

  describe("session lifecycle", () => {
    it("should work across lock/unlock cycles", async () => {
      const mutations = useDataSourceMutations();
      const originalApiKey = "persistent-api-key";

      // Session 1: Add data
      const id = await mutations.add({
        type: "notion",
        name: "Test Notion",
        apiKey: originalApiKey,
      });

      // Verify data is encrypted in storage
      const storedEntity1 = await db.dataSources.get(id);
      expect(storedEntity1?.apiKey).not.toBe(originalApiKey);

      // Lock encryption (simulating page reload)
      lockEncryption();

      // Session 2: Unlock and read
      await unlockEncryption("test-passphrase");
      const dataSource = await getDataSource(id);

      // Should get back original plaintext
      expect(dataSource?.apiKey).toBe(originalApiKey);
    });

    it("should fail to read after wrong passphrase unlock", async () => {
      const mutations = useDataSourceMutations();

      // Add data with correct passphrase
      const id = await mutations.add({
        type: "notion",
        name: "Test Notion",
        apiKey: "secret-key",
      });

      // Lock encryption
      lockEncryption();

      // Try to unlock with wrong passphrase
      await expect(unlockEncryption("wrong-passphrase")).rejects.toThrow(
        "Invalid passphrase",
      );

      // Should not be able to read (key still locked)
      await expect(getDataSource(id)).rejects.toThrow("Encryption is locked");
    });
  });

  describe("edge cases", () => {
    it("should handle data source without sensitive fields", async () => {
      const mutations = useDataSourceMutations();

      const id = await mutations.add({
        type: "csv",
        name: "Test CSV",
        // No apiKey or connectionString
      });

      const dataSource = await getDataSource(id);

      expect(dataSource?.name).toBe("Test CSV");
      expect(dataSource?.apiKey).toBeUndefined();
      expect(dataSource?.connectionString).toBeUndefined();
    });

    it("should handle whitespace-only apiKey gracefully", async () => {
      const mutations = useDataSourceMutations();

      const id = await mutations.add({
        type: "notion",
        name: "Test",
        apiKey: "   ", // Whitespace only
      });

      // Read directly from IndexedDB
      const storedEntity = await db.dataSources.get(id);

      // Whitespace-only should not be encrypted
      expect(storedEntity?.apiKey).toBe("   ");

      // Read using repository
      const dataSource = await getDataSource(id);
      expect(dataSource?.apiKey).toBe("   ");
    });

    it("should preserve other entity fields during encryption", async () => {
      const mutations = useDataSourceMutations();

      const input: CreateDataSourceInput = {
        type: "notion",
        name: "Test Notion",
        apiKey: "secret-key",
      };

      const id = await mutations.add(input);
      const dataSource = await getDataSource(id);

      // All fields should be preserved
      expect(dataSource?.id).toBe(id);
      expect(dataSource?.type).toBe("notion");
      expect(dataSource?.name).toBe("Test Notion");
      expect(dataSource?.apiKey).toBe("secret-key");
      expect(dataSource?.createdAt).toBeGreaterThan(0);
    });

    it("should handle concurrent add operations", async () => {
      const mutations = useDataSourceMutations();

      // Add multiple data sources concurrently
      const results = await Promise.all([
        mutations.add({ type: "notion", name: "Source 1", apiKey: "key1" }),
        mutations.add({ type: "notion", name: "Source 2", apiKey: "key2" }),
        mutations.add({ type: "notion", name: "Source 3", apiKey: "key3" }),
      ]);

      // All should succeed
      expect(results).toHaveLength(3);

      // All should be decrypted correctly
      const source1 = await getDataSource(results[0]);
      const source2 = await getDataSource(results[1]);
      const source3 = await getDataSource(results[2]);

      expect(source1?.apiKey).toBe("key1");
      expect(source2?.apiKey).toBe("key2");
      expect(source3?.apiKey).toBe("key3");
    });
  });

  describe("encryption verification", () => {
    it("should produce different ciphertexts for same plaintext (random IV)", async () => {
      const mutations = useDataSourceMutations();
      const sameApiKey = "same-api-key";

      // Add two data sources with same apiKey
      const id1 = await mutations.add({
        type: "notion",
        name: "Source 1",
        apiKey: sameApiKey,
      });

      const id2 = await mutations.add({
        type: "notion",
        name: "Source 2",
        apiKey: sameApiKey,
      });

      // Read directly from IndexedDB
      const stored1 = await db.dataSources.get(id1);
      const stored2 = await db.dataSources.get(id2);

      // Ciphertexts should be different (due to random IV)
      expect(stored1?.apiKey).not.toBe(stored2?.apiKey);

      // But both should decrypt to same plaintext
      const decrypted1 = await getDataSource(id1);
      const decrypted2 = await getDataSource(id2);

      expect(decrypted1?.apiKey).toBe(sameApiKey);
      expect(decrypted2?.apiKey).toBe(sameApiKey);
    });

    it("should use base64 encoding for ciphertext", async () => {
      const mutations = useDataSourceMutations();

      const id = await mutations.add({
        type: "notion",
        name: "Test",
        apiKey: "secret",
      });

      // Read directly from IndexedDB
      const stored = await db.dataSources.get(id);

      // Base64 regex pattern
      const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
      expect(stored?.apiKey).toMatch(base64Pattern);
    });
  });
});
