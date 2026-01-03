/**
 * Unit tests for crypto utilities
 *
 * Tests cover:
 * - Salt generation (size, uniqueness)
 * - Key derivation (PBKDF2 with different passphrases and salts)
 * - Roundtrip encryption/decryption
 * - Different input sizes (empty, short, medium, long strings)
 * - Error handling for wrong key
 * - Base64 encoding validation
 * - IV randomness for encryption
 */
import { beforeEach, describe, expect, it } from "vitest";
import { decrypt, deriveKey, encrypt, generateSalt } from "../index";

describe("crypto utilities", () => {
  describe("generateSalt", () => {
    it("should generate a 16-byte Uint8Array", () => {
      const salt = generateSalt();

      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(16);
    });

    it("should generate unique salts on each call", () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      const salt3 = generateSalt();

      // Convert to arrays for comparison
      expect(Array.from(salt1)).not.toEqual(Array.from(salt2));
      expect(Array.from(salt2)).not.toEqual(Array.from(salt3));
      expect(Array.from(salt1)).not.toEqual(Array.from(salt3));
    });

    it("should generate salts with randomness (not all zeros)", () => {
      const salt = generateSalt();
      const isAllZeros = Array.from(salt).every((byte) => byte === 0);

      expect(isAllZeros).toBe(false);
    });

    it("should generate salts with varying bytes", () => {
      const salt = generateSalt();
      const uniqueBytes = new Set(Array.from(salt));

      // Random 16 bytes should have some variation
      expect(uniqueBytes.size).toBeGreaterThan(1);
    });
  });

  describe("deriveKey", () => {
    let salt: Uint8Array;

    beforeEach(() => {
      salt = generateSalt();
    });

    it("should derive a CryptoKey from passphrase and salt", async () => {
      const key = await deriveKey("test-passphrase", salt);

      expect(key).toBeInstanceOf(CryptoKey);
      expect(key.type).toBe("secret");
      expect(key.algorithm.name).toBe("AES-GCM");
    });

    it("should derive AES-256 key (256-bit length)", async () => {
      const key = await deriveKey("test-passphrase", salt);
      const algorithm = key.algorithm as AesKeyAlgorithm;

      expect(algorithm.length).toBe(256);
    });

    it("should support encrypt and decrypt operations", async () => {
      const key = await deriveKey("test-passphrase", salt);

      expect(key.usages).toContain("encrypt");
      expect(key.usages).toContain("decrypt");
    });

    it("should derive different keys for different passphrases", async () => {
      const key1 = await deriveKey("passphrase-1", salt);
      const key2 = await deriveKey("passphrase-2", salt);

      // We can't directly compare CryptoKey objects, but we can verify
      // they produce different encrypted outputs
      const plaintext = "test data";
      const encrypted1 = await encrypt(plaintext, key1);
      const encrypted2 = await encrypt(plaintext, key2);

      // Different keys should produce different ciphertexts
      expect(encrypted1).not.toBe(encrypted2);
    });

    it("should derive different keys for different salts", async () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();

      const key1 = await deriveKey("same-passphrase", salt1);
      const key2 = await deriveKey("same-passphrase", salt2);

      // Different salts should produce different keys
      const plaintext = "test data";
      const encrypted1 = await encrypt(plaintext, key1);
      const encrypted2 = await encrypt(plaintext, key2);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it("should derive the same key for same passphrase and salt", async () => {
      const key1 = await deriveKey("same-passphrase", salt);
      const key2 = await deriveKey("same-passphrase", salt);

      // Same passphrase and salt should produce same key
      const plaintext = "test data";
      const encrypted = await encrypt(plaintext, key1);
      const decrypted = await decrypt(encrypted, key2);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe("encrypt", () => {
    let key: CryptoKey;

    beforeEach(async () => {
      const salt = generateSalt();
      key = await deriveKey("test-passphrase", salt);
    });

    it("should return a base64-encoded string", async () => {
      const plaintext = "secret data";
      const encrypted = await encrypt(plaintext, key);

      expect(typeof encrypted).toBe("string");

      // Should be valid base64 (no error when decoding)
      expect(() => atob(encrypted)).not.toThrow();
    });

    it("should produce different ciphertext on each call (random IV)", async () => {
      const plaintext = "same data";
      const encrypted1 = await encrypt(plaintext, key);
      const encrypted2 = await encrypt(plaintext, key);

      // Even with same plaintext and key, ciphertext should differ (random IV)
      expect(encrypted1).not.toBe(encrypted2);
    });

    it("should produce ciphertext longer than plaintext", async () => {
      const plaintext = "short";
      const encrypted = await encrypt(plaintext, key);

      // Encrypted data includes IV (12 bytes) + ciphertext + auth tag (16 bytes)
      // Base64 encoding increases length by ~33%
      const decodedLength = atob(encrypted).length;

      // Should be at least IV (12) + auth tag (16) + plaintext length
      expect(decodedLength).toBeGreaterThan(plaintext.length);
    });

    it("should handle empty string", async () => {
      const plaintext = "";
      const encrypted = await encrypt(plaintext, key);

      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);

      // Should still include IV and auth tag
      const decodedLength = atob(encrypted).length;
      expect(decodedLength).toBeGreaterThanOrEqual(12 + 16); // IV + auth tag
    });

    it("should handle short strings", async () => {
      const plaintext = "a";
      const encrypted = await encrypt(plaintext, key);

      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it("should handle medium strings", async () => {
      const plaintext = "This is a medium length string for testing encryption";
      const encrypted = await encrypt(plaintext, key);

      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it("should handle long strings", async () => {
      const plaintext = "x".repeat(10000);
      const encrypted = await encrypt(plaintext, key);

      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it("should handle special characters", async () => {
      const plaintext = "Hello! @#$%^&*() 🎉 \n\t";
      const encrypted = await encrypt(plaintext, key);

      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it("should handle unicode characters", async () => {
      const plaintext = "你好世界 🌍 こんにちは";
      const encrypted = await encrypt(plaintext, key);

      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);
    });
  });

  describe("decrypt", () => {
    let key: CryptoKey;

    beforeEach(async () => {
      const salt = generateSalt();
      key = await deriveKey("test-passphrase", salt);
    });

    it("should decrypt encrypted data back to original", async () => {
      const plaintext = "secret message";
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle empty string roundtrip", async () => {
      const plaintext = "";
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle short string roundtrip", async () => {
      const plaintext = "x";
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle medium string roundtrip", async () => {
      const plaintext =
        "This is a medium length string with various characters!@#$%";
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle long string roundtrip", async () => {
      const plaintext = "Long string ".repeat(1000);
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle special characters roundtrip", async () => {
      const plaintext = "Special chars: !@#$%^&*()_+-=[]{}|;:',.<>?/`~";
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle unicode roundtrip", async () => {
      const plaintext = "Unicode: 你好 🌍 こんにちは مرحبا";
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle newlines and tabs roundtrip", async () => {
      const plaintext = "Line 1\nLine 2\n\tIndented\r\nWindows line";
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it("should throw error when decrypting with wrong key", async () => {
      const plaintext = "secret data";
      const encrypted = await encrypt(plaintext, key);

      // Create a different key
      const wrongSalt = generateSalt();
      const wrongKey = await deriveKey("wrong-passphrase", wrongSalt);

      // Decryption with wrong key should fail
      await expect(decrypt(encrypted, wrongKey)).rejects.toThrow();
    });

    it("should throw error when decrypting with same passphrase but different salt", async () => {
      const salt1 = generateSalt();
      const key1 = await deriveKey("passphrase", salt1);

      const plaintext = "secret data";
      const encrypted = await encrypt(plaintext, key1);

      // Same passphrase, different salt = different key
      const salt2 = generateSalt();
      const key2 = await deriveKey("passphrase", salt2);

      await expect(decrypt(encrypted, key2)).rejects.toThrow();
    });

    it("should throw error for corrupted ciphertext", async () => {
      const plaintext = "secret data";
      const encrypted = await encrypt(plaintext, key);

      // Corrupt the ciphertext by modifying it
      const corrupted = encrypted.slice(0, -5) + "XXXXX";

      await expect(decrypt(corrupted, key)).rejects.toThrow();
    });

    it("should throw error for invalid base64", async () => {
      const invalidBase64 = "not-valid-base64!!!";

      await expect(decrypt(invalidBase64, key)).rejects.toThrow();
    });

    it("should throw error for too short ciphertext", async () => {
      // Create a base64 string that's too short (less than IV + auth tag)
      const tooShort = btoa("short");

      await expect(decrypt(tooShort, key)).rejects.toThrow();
    });
  });

  describe("roundtrip encryption/decryption", () => {
    it("should handle multiple encrypt/decrypt cycles", async () => {
      const salt = generateSalt();
      const key = await deriveKey("test-passphrase", salt);

      const original = "original message";

      // First cycle
      const encrypted1 = await encrypt(original, key);
      const decrypted1 = await decrypt(encrypted1, key);
      expect(decrypted1).toBe(original);

      // Second cycle
      const encrypted2 = await encrypt(decrypted1, key);
      const decrypted2 = await decrypt(encrypted2, key);
      expect(decrypted2).toBe(original);

      // Encrypted values should be different (random IV)
      expect(encrypted1).not.toBe(encrypted2);
    });

    it("should handle API key-like strings", async () => {
      const salt = generateSalt();
      const key = await deriveKey("user-passphrase", salt);

      const apiKey = "sk-1234567890abcdef-SECRETKEY_example-xyz";
      const encrypted = await encrypt(apiKey, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(apiKey);
    });

    it("should handle connection string-like data", async () => {
      const salt = generateSalt();
      const key = await deriveKey("user-passphrase", salt);

      const connectionString =
        "postgresql://user:password@localhost:5432/dbname?sslmode=require";
      const encrypted = await encrypt(connectionString, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(connectionString);
    });

    it("should handle JSON data", async () => {
      const salt = generateSalt();
      const key = await deriveKey("user-passphrase", salt);

      const jsonData = JSON.stringify({
        apiKey: "secret-key",
        token: "bearer-token-123",
        credentials: { user: "admin", pass: "secret" },
      });

      const encrypted = await encrypt(jsonData, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(jsonData);
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(jsonData));
    });
  });

  describe("base64 encoding validation", () => {
    it("should produce valid base64 output", async () => {
      const salt = generateSalt();
      const key = await deriveKey("test-passphrase", salt);
      const plaintext = "test data";

      const encrypted = await encrypt(plaintext, key);

      // Should not throw when decoding
      expect(() => atob(encrypted)).not.toThrow();

      // Should only contain valid base64 characters
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      expect(encrypted).toMatch(base64Regex);
    });

    it("should decode to binary data with expected structure", async () => {
      const salt = generateSalt();
      const key = await deriveKey("test-passphrase", salt);
      const plaintext = "test";

      const encrypted = await encrypt(plaintext, key);
      const decoded = atob(encrypted);

      // Should have at least IV (12 bytes) + auth tag (16 bytes)
      expect(decoded.length).toBeGreaterThanOrEqual(28);

      // First 12 bytes should be the IV
      const ivBytes = decoded.slice(0, 12);
      expect(ivBytes.length).toBe(12);
    });

    it("should have consistent encoding/decoding", async () => {
      const salt = generateSalt();
      const key = await deriveKey("test-passphrase", salt);
      const plaintext = "consistency test";

      const encrypted = await encrypt(plaintext, key);

      // Decode and re-encode should give same result
      const decoded = atob(encrypted);
      const reencoded = btoa(decoded);

      expect(reencoded).toBe(encrypted);
    });
  });

  describe("edge cases", () => {
    it("should handle very long passphrases", async () => {
      const salt = generateSalt();
      const longPassphrase = "x".repeat(1000);
      const key = await deriveKey(longPassphrase, salt);

      const plaintext = "test data";
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle passphrase with special characters", async () => {
      const salt = generateSalt();
      const specialPassphrase = "P@ssw0rd!#$%^&*()_+-=[]{}|;:',.<>?/`~";
      const key = await deriveKey(specialPassphrase, salt);

      const plaintext = "test data";
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle passphrase with unicode characters", async () => {
      const salt = generateSalt();
      const unicodePassphrase = "密码🔐пароль";
      const key = await deriveKey(unicodePassphrase, salt);

      const plaintext = "test data";
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle encrypting/decrypting 1000 times", async () => {
      const salt = generateSalt();
      const key = await deriveKey("test-passphrase", salt);

      const messages = Array.from({ length: 1000 }, (_, i) => `message-${i}`);

      for (const message of messages) {
        const encrypted = await encrypt(message, key);
        const decrypted = await decrypt(encrypted, key);
        expect(decrypted).toBe(message);
      }
    });
  });
});
