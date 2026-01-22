/* eslint-disable sonarjs/no-hardcoded-passwords -- Test files require test passwords */
/**
 * End-to-end integration tests for encryption feature
 *
 * Tests the complete encryption flow:
 * 1. Setup passphrase (first-time initialization)
 * 2. Add data source with API key
 * 3. Simulate page reload (clear memory cache)
 * 4. Unlock encryption
 * 5. Verify data accessible and correctly decrypted
 * 6. Test wrong passphrase rejection
 */
import type { CreateDataSourceInput } from "@dashframe/types";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  initializeEncryption,
  isEncryptionInitialized,
  isEncryptionUnlocked,
  lockEncryption,
  unlockEncryption,
} from "../crypto/key-manager";
import { db } from "../db";
import {
  addDataSource,
  getAllDataSources,
  getDataSource,
  updateDataSource,
} from "../repositories/data-sources";

describe("encryption integration - full flow", () => {
  // Reset database and in-memory state before each test
  beforeEach(async () => {
    lockEncryption(); // Clear in-memory cached key
    await db.settings.clear();
    await db.dataSources.clear();
  });

  it("should complete full encryption lifecycle: setup -> add data -> reload -> unlock -> access", async () => {
    const passphrase = "my-secure-passphrase-123";
    const apiKey = "secret_notion_api_key_abc123";
    const connectionString = "postgresql://user:pass@localhost:5432/mydb";

    // 1. Setup passphrase (first-time initialization)
    await initializeEncryption(passphrase);

    // Verify encryption is initialized and unlocked
    expect(await isEncryptionInitialized()).toBe(true);
    expect(isEncryptionUnlocked()).toBe(true);

    // 2. Add data source with API key
    const input: CreateDataSourceInput = {
      type: "notion",
      name: "My Notion Workspace",
      apiKey: apiKey,
      connectionString: connectionString,
    };

    const dataSourceId = await addDataSource(input);
    expect(dataSourceId).toBeDefined();

    // Verify data is encrypted in storage
    const storedEntity = await db.dataSources.get(dataSourceId);
    expect(storedEntity?.apiKey).not.toBe(apiKey);
    expect(storedEntity?.connectionString).not.toBe(connectionString);

    // Verify data can be read (decrypted) while unlocked
    const dataSourceBeforeReload = await getDataSource(dataSourceId);
    expect(dataSourceBeforeReload?.apiKey).toBe(apiKey);
    expect(dataSourceBeforeReload?.connectionString).toBe(connectionString);
    expect(dataSourceBeforeReload?.name).toBe("My Notion Workspace");

    // 3. Simulate page reload (clear memory cache)
    lockEncryption();

    // Verify encryption is locked
    expect(await isEncryptionInitialized()).toBe(true); // Still initialized
    expect(isEncryptionUnlocked()).toBe(false); // But locked

    // Verify data cannot be accessed while locked
    await expect(getDataSource(dataSourceId)).rejects.toThrow(
      "Encryption is locked",
    );

    // 4. Unlock encryption with correct passphrase
    await unlockEncryption(passphrase);

    // Verify encryption is unlocked
    expect(isEncryptionUnlocked()).toBe(true);

    // 5. Verify data accessible and correctly decrypted
    const dataSourceAfterUnlock = await getDataSource(dataSourceId);
    expect(dataSourceAfterUnlock).toBeDefined();
    expect(dataSourceAfterUnlock?.id).toBe(dataSourceId);
    expect(dataSourceAfterUnlock?.type).toBe("notion");
    expect(dataSourceAfterUnlock?.name).toBe("My Notion Workspace");
    expect(dataSourceAfterUnlock?.apiKey).toBe(apiKey);
    expect(dataSourceAfterUnlock?.connectionString).toBe(connectionString);

    // Verify data is still encrypted in storage (not plaintext)
    const storedEntityAfterUnlock = await db.dataSources.get(dataSourceId);
    expect(storedEntityAfterUnlock?.apiKey).not.toBe(apiKey);
    expect(storedEntityAfterUnlock?.connectionString).not.toBe(
      connectionString,
    );
  });

  it("should reject wrong passphrase and keep data inaccessible", async () => {
    const correctPassphrase = "correct-passphrase";
    const wrongPassphrase = "wrong-passphrase";
    const apiKey = "secret_api_key";

    // Setup with correct passphrase
    await initializeEncryption(correctPassphrase);

    // Add data source
    const dataSourceId = await addDataSource({
      type: "notion",
      name: "Test Notion",
      apiKey: apiKey,
    });

    // Simulate page reload
    lockEncryption();

    // Try to unlock with wrong passphrase
    await expect(unlockEncryption(wrongPassphrase)).rejects.toThrow(
      "Invalid passphrase",
    );

    // Verify encryption is still locked
    expect(isEncryptionUnlocked()).toBe(false);

    // Verify data is still inaccessible
    await expect(getDataSource(dataSourceId)).rejects.toThrow(
      "Encryption is locked",
    );

    // Unlock with correct passphrase
    await unlockEncryption(correctPassphrase);

    // Now data should be accessible
    const dataSource = await getDataSource(dataSourceId);
    expect(dataSource?.apiKey).toBe(apiKey);
  });

  it("should handle multiple data sources across reload", async () => {
    const passphrase = "test-passphrase";

    // Initialize encryption
    await initializeEncryption(passphrase);

    // Add multiple data sources
    const sources = [
      { type: "notion", name: "Notion 1", apiKey: "notion_key_1" },
      { type: "notion", name: "Notion 2", apiKey: "notion_key_2" },
      {
        type: "postgres",
        name: "Database 1",
        connectionString: "postgresql://localhost/db1",
      },
    ];

    const ids = await Promise.all(sources.map((s) => addDataSource(s)));
    expect(ids).toHaveLength(3);

    // Verify all data is accessible before reload
    const allSourcesBeforeReload = await getAllDataSources();
    expect(allSourcesBeforeReload).toHaveLength(3);
    expect(allSourcesBeforeReload[0].apiKey).toBe("notion_key_1");
    expect(allSourcesBeforeReload[1].apiKey).toBe("notion_key_2");
    expect(allSourcesBeforeReload[2].connectionString).toBe(
      "postgresql://localhost/db1",
    );

    // Simulate page reload
    lockEncryption();

    // Verify data is inaccessible
    await expect(getAllDataSources()).rejects.toThrow("Encryption is locked");

    // Unlock encryption
    await unlockEncryption(passphrase);

    // Verify all data is accessible again
    const allSourcesAfterReload = await getAllDataSources();
    expect(allSourcesAfterReload).toHaveLength(3);
    expect(allSourcesAfterReload[0].apiKey).toBe("notion_key_1");
    expect(allSourcesAfterReload[1].apiKey).toBe("notion_key_2");
    expect(allSourcesAfterReload[2].connectionString).toBe(
      "postgresql://localhost/db1",
    );
  });

  it("should handle update operations across reload", async () => {
    const passphrase = "update-test-passphrase";
    const originalApiKey = "original-api-key";
    const updatedApiKey = "updated-api-key";

    // Initialize and add data source
    await initializeEncryption(passphrase);
    const dataSourceId = await addDataSource({
      type: "notion",
      name: "Test Notion",
      apiKey: originalApiKey,
    });

    // Verify original data
    const original = await getDataSource(dataSourceId);
    expect(original?.apiKey).toBe(originalApiKey);

    // Update API key
    await updateDataSource(dataSourceId, { apiKey: updatedApiKey });

    // Verify update
    const updated = await getDataSource(dataSourceId);
    expect(updated?.apiKey).toBe(updatedApiKey);

    // Simulate page reload
    lockEncryption();

    // Unlock encryption
    await unlockEncryption(passphrase);

    // Verify updated data persists after reload
    const afterReload = await getDataSource(dataSourceId);
    expect(afterReload?.apiKey).toBe(updatedApiKey);
    expect(afterReload?.name).toBe("Test Notion");

    // Verify data is encrypted in storage
    const stored = await db.dataSources.get(dataSourceId);
    expect(stored?.apiKey).not.toBe(updatedApiKey);
  });

  it("should prevent mutations without unlocked key after reload", async () => {
    const passphrase = "mutation-test-passphrase";

    // Initialize encryption
    await initializeEncryption(passphrase);

    // Simulate page reload
    lockEncryption();

    // Try to add data source without unlocking
    await expect(
      addDataSource({
        type: "notion",
        name: "Test",
        apiKey: "secret",
      }),
    ).rejects.toThrow("Encryption is locked");

    // Unlock encryption
    await unlockEncryption(passphrase);

    // Now mutation should succeed
    const dataSourceId = await addDataSource({
      type: "notion",
      name: "Test",
      apiKey: "secret",
    });

    expect(dataSourceId).toBeDefined();
  });

  it("should maintain data integrity across multiple lock/unlock cycles", async () => {
    const passphrase = "cycle-test-passphrase";
    const apiKey = "persistent-api-key";

    // Initialize and add data
    await initializeEncryption(passphrase);
    const dataSourceId = await addDataSource({
      type: "notion",
      name: "Persistent Source",
      apiKey: apiKey,
    });

    // First lock/unlock cycle
    lockEncryption();
    await unlockEncryption(passphrase);
    const afterCycle1 = await getDataSource(dataSourceId);
    expect(afterCycle1?.apiKey).toBe(apiKey);

    // Second lock/unlock cycle
    lockEncryption();
    await unlockEncryption(passphrase);
    const afterCycle2 = await getDataSource(dataSourceId);
    expect(afterCycle2?.apiKey).toBe(apiKey);

    // Third lock/unlock cycle
    lockEncryption();
    await unlockEncryption(passphrase);
    const afterCycle3 = await getDataSource(dataSourceId);
    expect(afterCycle3?.apiKey).toBe(apiKey);

    // Verify data is still encrypted in storage
    const stored = await db.dataSources.get(dataSourceId);
    expect(stored?.apiKey).not.toBe(apiKey);
  });

  it("should handle special characters and unicode in sensitive data across reload", async () => {
    const passphrase = "unicode-test-passphrase";
    const specialApiKey = "sk-!@#$%^&*()_+-=[]{}|;:',.<>?/`~";
    const unicodeConnectionString = "postgresql://用户:密码@localhost/数据库";

    // Initialize and add data
    await initializeEncryption(passphrase);
    const dataSourceId = await addDataSource({
      type: "custom",
      name: "Special Characters Test",
      apiKey: specialApiKey,
      connectionString: unicodeConnectionString,
    });

    // Verify before reload
    const beforeReload = await getDataSource(dataSourceId);
    expect(beforeReload?.apiKey).toBe(specialApiKey);
    expect(beforeReload?.connectionString).toBe(unicodeConnectionString);

    // Simulate page reload
    lockEncryption();
    await unlockEncryption(passphrase);

    // Verify after reload
    const afterReload = await getDataSource(dataSourceId);
    expect(afterReload?.apiKey).toBe(specialApiKey);
    expect(afterReload?.connectionString).toBe(unicodeConnectionString);
  });

  it("should handle very long API keys across reload", async () => {
    const passphrase = "long-key-test-passphrase";
    const longApiKey = "sk-" + "a".repeat(2000); // Very long key

    // Initialize and add data
    await initializeEncryption(passphrase);
    const dataSourceId = await addDataSource({
      type: "notion",
      name: "Long Key Test",
      apiKey: longApiKey,
    });

    // Verify before reload
    const beforeReload = await getDataSource(dataSourceId);
    expect(beforeReload?.apiKey).toBe(longApiKey);
    expect(beforeReload?.apiKey?.length).toBe(2003);

    // Simulate page reload
    lockEncryption();
    await unlockEncryption(passphrase);

    // Verify after reload
    const afterReload = await getDataSource(dataSourceId);
    expect(afterReload?.apiKey).toBe(longApiKey);
    expect(afterReload?.apiKey?.length).toBe(2003);
  });

  it("should require passphrase on first access after initialization check", async () => {
    const passphrase = "first-access-passphrase";

    // Initialize encryption
    await initializeEncryption(passphrase);

    // Add data
    const dataSourceId = await addDataSource({
      type: "notion",
      name: "Test",
      apiKey: "secret",
    });

    // Simulate page reload (database persists, memory cleared)
    lockEncryption();

    // In a real app, isEncryptionInitialized() would be checked on page load
    const initialized = await isEncryptionInitialized();
    expect(initialized).toBe(true);

    // But encryption should be locked
    expect(isEncryptionUnlocked()).toBe(false);

    // Data should be inaccessible
    await expect(getDataSource(dataSourceId)).rejects.toThrow(
      "Encryption is locked",
    );

    // User must unlock with passphrase
    await unlockEncryption(passphrase);

    // Now data is accessible
    const dataSource = await getDataSource(dataSourceId);
    expect(dataSource?.apiKey).toBe("secret");
  });

  it("should handle concurrent reads after unlock", async () => {
    const passphrase = "concurrent-test-passphrase";

    // Initialize and add multiple data sources
    await initializeEncryption(passphrase);

    const ids = await Promise.all([
      addDataSource({ type: "notion", name: "Source 1", apiKey: "key1" }),
      addDataSource({ type: "notion", name: "Source 2", apiKey: "key2" }),
      addDataSource({ type: "notion", name: "Source 3", apiKey: "key3" }),
      addDataSource({ type: "notion", name: "Source 4", apiKey: "key4" }),
      addDataSource({ type: "notion", name: "Source 5", apiKey: "key5" }),
    ]);

    // Simulate page reload
    lockEncryption();
    await unlockEncryption(passphrase);

    // Concurrent reads
    const sources = await Promise.all([
      getDataSource(ids[0]),
      getDataSource(ids[1]),
      getDataSource(ids[2]),
      getDataSource(ids[3]),
      getDataSource(ids[4]),
    ]);

    // All should be decrypted correctly
    expect(sources[0]?.apiKey).toBe("key1");
    expect(sources[1]?.apiKey).toBe("key2");
    expect(sources[2]?.apiKey).toBe("key3");
    expect(sources[3]?.apiKey).toBe("key4");
    expect(sources[4]?.apiKey).toBe("key5");
  });
});
