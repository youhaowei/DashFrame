/* eslint-disable sonarjs/no-hardcoded-passwords -- Test files require test passwords */
/**
 * Unit tests for encryption key manager
 *
 * Tests cover:
 * - Initialization flow (salt and verifier storage)
 * - Unlock flow with correct/wrong passphrase
 * - Key caching and locking
 * - State management (initialized, unlocked)
 * - Error handling and edge cases
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db";
import {
  getEncryptionKey,
  initializeEncryption,
  isEncryptionInitialized,
  isEncryptionUnlocked,
  lockEncryption,
  unlockEncryption,
} from "../key-manager";

describe("key-manager", () => {
  // Reset database before each test
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  describe("isEncryptionInitialized", () => {
    it("should return false when encryption is not initialized", async () => {
      const initialized = await isEncryptionInitialized();
      expect(initialized).toBe(false);
    });

    it("should return true after encryption is initialized", async () => {
      await initializeEncryption("test-passphrase");
      const initialized = await isEncryptionInitialized();
      expect(initialized).toBe(true);
    });
  });

  describe("initializeEncryption", () => {
    it("should initialize encryption with a passphrase", async () => {
      await initializeEncryption("my-secure-passphrase");

      // Should be initialized
      const initialized = await isEncryptionInitialized();
      expect(initialized).toBe(true);

      // Should be unlocked
      expect(isEncryptionUnlocked()).toBe(true);
    });

    it("should store salt in IndexedDB settings table", async () => {
      await initializeEncryption("test-passphrase");

      // Check salt is stored
      const saltSetting = await db.settings.get("encryption:salt");
      expect(saltSetting).toBeDefined();
      expect(saltSetting?.key).toBe("encryption:salt");
      expect(saltSetting?.value).toBeTruthy();
      expect(typeof saltSetting?.value).toBe("string");
    });

    it("should store verifier in IndexedDB settings table", async () => {
      await initializeEncryption("test-passphrase");

      // Check verifier is stored
      const verifierSetting = await db.settings.get("encryption:verifier");
      expect(verifierSetting).toBeDefined();
      expect(verifierSetting?.key).toBe("encryption:verifier");
      expect(verifierSetting?.value).toBeTruthy();
      expect(typeof verifierSetting?.value).toBe("string");
    });

    it("should cache encryption key in memory", async () => {
      await initializeEncryption("test-passphrase");

      // Should be unlocked (key cached)
      expect(isEncryptionUnlocked()).toBe(true);

      // Should be able to get key
      const key = getEncryptionKey();
      expect(key).toBeInstanceOf(CryptoKey);
    });

    it("should throw error if already initialized", async () => {
      await initializeEncryption("first-passphrase");

      // Second initialization should fail
      await expect(initializeEncryption("second-passphrase")).rejects.toThrow(
        "Encryption is already initialized",
      );
    });

    it("should throw error for empty passphrase", async () => {
      await expect(initializeEncryption("")).rejects.toThrow(
        "Passphrase cannot be empty",
      );
    });

    it("should throw error for whitespace-only passphrase", async () => {
      await expect(initializeEncryption("   ")).rejects.toThrow(
        "Passphrase cannot be empty",
      );
    });

    it("should handle different passphrases", async () => {
      await initializeEncryption("passphrase-1");
      const salt1 = await db.settings.get("encryption:salt");
      const verifier1 = await db.settings.get("encryption:verifier");

      // Reset database
      await db.delete();
      await db.open();

      await initializeEncryption("passphrase-2");
      const salt2 = await db.settings.get("encryption:salt");
      const verifier2 = await db.settings.get("encryption:verifier");

      // Different passphrases should produce different verifiers
      expect(salt1?.value).not.toBe(salt2?.value);
      expect(verifier1?.value).not.toBe(verifier2?.value);
    });
  });

  describe("unlockEncryption", () => {
    beforeEach(async () => {
      // Initialize encryption for unlock tests
      await initializeEncryption("test-passphrase");
      // Lock it to test unlock
      lockEncryption();
    });

    it("should unlock with correct passphrase", async () => {
      await unlockEncryption("test-passphrase");

      expect(isEncryptionUnlocked()).toBe(true);
    });

    it("should cache encryption key after unlock", async () => {
      await unlockEncryption("test-passphrase");

      const key = getEncryptionKey();
      expect(key).toBeInstanceOf(CryptoKey);
      expect(key.type).toBe("secret");
    });

    it("should throw error with wrong passphrase", async () => {
      await expect(unlockEncryption("wrong-passphrase")).rejects.toThrow(
        "Invalid passphrase",
      );

      // Should still be locked
      expect(isEncryptionUnlocked()).toBe(false);
    });

    it("should throw error if not initialized", async () => {
      // Reset database (not initialized)
      await db.delete();
      await db.open();

      await expect(unlockEncryption("any-passphrase")).rejects.toThrow(
        "Encryption is not initialized",
      );
    });

    it("should throw error for empty passphrase", async () => {
      await expect(unlockEncryption("")).rejects.toThrow(
        "Passphrase cannot be empty",
      );
    });

    it("should throw error for whitespace-only passphrase", async () => {
      await expect(unlockEncryption("   ")).rejects.toThrow(
        "Passphrase cannot be empty",
      );
    });

    it("should work after multiple lock/unlock cycles", async () => {
      // First unlock
      await unlockEncryption("test-passphrase");
      expect(isEncryptionUnlocked()).toBe(true);

      // Lock
      lockEncryption();
      expect(isEncryptionUnlocked()).toBe(false);

      // Second unlock
      await unlockEncryption("test-passphrase");
      expect(isEncryptionUnlocked()).toBe(true);

      // Lock again
      lockEncryption();
      expect(isEncryptionUnlocked()).toBe(false);

      // Third unlock
      await unlockEncryption("test-passphrase");
      expect(isEncryptionUnlocked()).toBe(true);
    });

    it("should derive the same key on each unlock", async () => {
      // First unlock
      await unlockEncryption("test-passphrase");
      const key1 = getEncryptionKey();

      // Lock and unlock again
      lockEncryption();
      await unlockEncryption("test-passphrase");
      const key2 = getEncryptionKey();

      // Keys should produce same encryption results
      const { encrypt } = await import("../index");
      const plaintext = "test data";
      const encrypted1 = await encrypt(plaintext, key1);
      const encrypted2 = await encrypt(plaintext, key2);

      // While ciphertexts differ (random IV), both keys should decrypt each other's data
      const { decrypt } = await import("../index");
      const decrypted1 = await decrypt(encrypted2, key1);
      const decrypted2 = await decrypt(encrypted1, key2);

      expect(decrypted1).toBe(plaintext);
      expect(decrypted2).toBe(plaintext);
    });
  });

  describe("isEncryptionUnlocked", () => {
    it("should return false when not initialized", () => {
      expect(isEncryptionUnlocked()).toBe(false);
    });

    it("should return true after initialization", async () => {
      await initializeEncryption("test-passphrase");
      expect(isEncryptionUnlocked()).toBe(true);
    });

    it("should return false after lock", async () => {
      await initializeEncryption("test-passphrase");
      lockEncryption();
      expect(isEncryptionUnlocked()).toBe(false);
    });

    it("should return true after unlock", async () => {
      await initializeEncryption("test-passphrase");
      lockEncryption();
      await unlockEncryption("test-passphrase");
      expect(isEncryptionUnlocked()).toBe(true);
    });
  });

  describe("getEncryptionKey", () => {
    it("should throw error when encryption is locked", () => {
      expect(() => getEncryptionKey()).toThrow("Encryption is locked");
    });

    it("should return CryptoKey when unlocked", async () => {
      await initializeEncryption("test-passphrase");

      const key = getEncryptionKey();
      expect(key).toBeInstanceOf(CryptoKey);
      expect(key.type).toBe("secret");
      expect(key.algorithm.name).toBe("AES-GCM");
    });

    it("should throw error after lock", async () => {
      await initializeEncryption("test-passphrase");
      lockEncryption();

      expect(() => getEncryptionKey()).toThrow("Encryption is locked");
    });

    it("should return same key instance while unlocked", async () => {
      await initializeEncryption("test-passphrase");

      const key1 = getEncryptionKey();
      const key2 = getEncryptionKey();

      expect(key1).toBe(key2);
    });
  });

  describe("lockEncryption", () => {
    it("should clear cached key from memory", async () => {
      await initializeEncryption("test-passphrase");
      expect(isEncryptionUnlocked()).toBe(true);

      lockEncryption();

      expect(isEncryptionUnlocked()).toBe(false);
      expect(() => getEncryptionKey()).toThrow();
    });

    it("should not affect stored salt and verifier", async () => {
      await initializeEncryption("test-passphrase");
      const saltBefore = await db.settings.get("encryption:salt");
      const verifierBefore = await db.settings.get("encryption:verifier");

      lockEncryption();

      const saltAfter = await db.settings.get("encryption:salt");
      const verifierAfter = await db.settings.get("encryption:verifier");

      expect(saltAfter).toEqual(saltBefore);
      expect(verifierAfter).toEqual(verifierBefore);
    });

    it("should allow unlock after lock", async () => {
      await initializeEncryption("test-passphrase");
      lockEncryption();

      // Should be able to unlock again
      await unlockEncryption("test-passphrase");
      expect(isEncryptionUnlocked()).toBe(true);
    });

    it("should be safe to call multiple times", async () => {
      await initializeEncryption("test-passphrase");

      lockEncryption();
      lockEncryption();
      lockEncryption();

      expect(isEncryptionUnlocked()).toBe(false);
    });

    it("should be safe to call when not initialized", () => {
      expect(() => lockEncryption()).not.toThrow();
      expect(isEncryptionUnlocked()).toBe(false);
    });
  });

  describe("integration scenarios", () => {
    it("should simulate session lifecycle (init -> use -> reload)", async () => {
      // Session 1: Initialize
      await initializeEncryption("my-passphrase");
      const key1 = getEncryptionKey();
      expect(isEncryptionUnlocked()).toBe(true);

      // Simulate page reload (clear in-memory cache)
      lockEncryption();

      // Session 2: Unlock
      expect(isEncryptionUnlocked()).toBe(false);
      await unlockEncryption("my-passphrase");
      const key2 = getEncryptionKey();
      expect(isEncryptionUnlocked()).toBe(true);

      // Keys should be functionally equivalent
      const { encrypt, decrypt } = await import("../index");
      const plaintext = "sensitive data";
      const encrypted = await encrypt(plaintext, key1);
      const decrypted = await decrypt(encrypted, key2);
      expect(decrypted).toBe(plaintext);
    });

    it("should handle encryption/decryption with key manager", async () => {
      const { encrypt, decrypt } = await import("../index");

      // Initialize and get key
      await initializeEncryption("secure-passphrase");
      const key = getEncryptionKey();

      // Encrypt data
      const apiKey = "sk-1234567890abcdef";
      const encrypted = await encrypt(apiKey, key);

      // Lock encryption
      lockEncryption();

      // Unlock and decrypt
      await unlockEncryption("secure-passphrase");
      const unlockedKey = getEncryptionKey();
      const decrypted = await decrypt(encrypted, unlockedKey);

      expect(decrypted).toBe(apiKey);
    });

    it("should prevent access without correct passphrase", async () => {
      // Initialize
      await initializeEncryption("correct-passphrase");
      lockEncryption();

      // Try to unlock with wrong passphrase
      await expect(unlockEncryption("wrong-passphrase")).rejects.toThrow(
        "Invalid passphrase",
      );

      // Should still be locked
      expect(isEncryptionUnlocked()).toBe(false);
      expect(() => getEncryptionKey()).toThrow();
    });

    it("should handle special characters in passphrase", async () => {
      const specialPassphrase = "P@ssw0rd!#$%^&*()_+-=[]{}|;:',.<>?/`~";

      await initializeEncryption(specialPassphrase);
      lockEncryption();

      await unlockEncryption(specialPassphrase);
      expect(isEncryptionUnlocked()).toBe(true);
    });

    it("should handle unicode characters in passphrase", async () => {
      const unicodePassphrase = "密码🔐пароль";

      await initializeEncryption(unicodePassphrase);
      lockEncryption();

      await unlockEncryption(unicodePassphrase);
      expect(isEncryptionUnlocked()).toBe(true);
    });

    it("should handle very long passphrase", async () => {
      const longPassphrase = "a".repeat(1000);

      await initializeEncryption(longPassphrase);
      lockEncryption();

      await unlockEncryption(longPassphrase);
      expect(isEncryptionUnlocked()).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should throw error if verifier is corrupted", async () => {
      await initializeEncryption("test-passphrase");
      lockEncryption();

      // Corrupt the verifier
      await db.settings.put({
        key: "encryption:verifier",
        value: "corrupted-verifier-data",
      });

      // Unlock should fail
      await expect(unlockEncryption("test-passphrase")).rejects.toThrow(
        "Invalid passphrase",
      );
    });

    it("should throw error if verifier is missing", async () => {
      await initializeEncryption("test-passphrase");
      lockEncryption();

      // Delete verifier
      await db.settings.delete("encryption:verifier");

      // Unlock should fail
      await expect(unlockEncryption("test-passphrase")).rejects.toThrow(
        "Encryption verifier not found",
      );
    });

    it("should throw error if salt is deleted after initialization", async () => {
      await initializeEncryption("test-passphrase");
      lockEncryption();

      // Delete salt
      await db.settings.delete("encryption:salt");

      // Unlock should fail
      await expect(unlockEncryption("test-passphrase")).rejects.toThrow(
        "Encryption is not initialized",
      );
    });
  });
});
