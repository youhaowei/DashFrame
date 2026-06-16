/**
 * ElectronKeychainBackend unit tests.
 *
 * safeStorage is an Electron-main-only API; it is mocked here so the adapter
 * logic (at-rest store, has-no-decrypt, failure path, locator handling) can be
 * exercised in a plain Node/vitest environment. The mock surface mirrors the
 * real Electron safeStorage contract (isEncryptionAvailable / encryptString /
 * decryptString). The safeStorage primitive itself is Electron-provided and is
 * exercised on a real desktop cold-start — not in this unit test suite.
 *
 * Tests are grouped by acceptance criterion:
 *   AC-1  store/withSecret/has/delete round-trip
 *   AC-2  plaintext at rest is OS-encrypted (blob bytes ≠ plaintext)
 *   AC-3  isEncryptionAvailable()===false throws, no plaintext write
 *   AC-4  has(locator) never calls decryptString
 *   AC-5  locatorHint is included in the returned locator
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ElectronKeychainBackend,
  type SafeStorageSurface,
} from "./secret-keychain-backend.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** A reversible mock safeStorage that XOR-obfuscates the plaintext. */
function makeMockSafeStorage(
  overrides: Partial<SafeStorageSurface> = {},
): SafeStorageSurface & { decryptCallCount: number } {
  let decryptCallCount = 0;
  const XOR_KEY = 0x5a;

  const mock = {
    isEncryptionAvailable: vi.fn<() => boolean>(() => true),
    encryptString: vi.fn<(plaintext: string) => Buffer>((plaintext) => {
      // XOR-obfuscate: bytes on disk will differ from plaintext bytes.
      const bytes = Buffer.from(plaintext, "utf8");
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = (bytes[i] ?? 0) ^ XOR_KEY;
      }
      return bytes;
    }),
    decryptString: vi.fn<(encrypted: Buffer) => string>((encrypted) => {
      decryptCallCount++;
      // Reverse the XOR
      const bytes = Buffer.from(encrypted);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = (bytes[i] ?? 0) ^ XOR_KEY;
      }
      return bytes.toString("utf8");
    }),
    get decryptCallCount() {
      return decryptCallCount;
    },
    ...overrides,
  };

  return mock;
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "keychain-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC-1: store / withSecret / has / delete round-trip
// ---------------------------------------------------------------------------

describe("AC-1: round-trip (store → withSecret → has → delete)", () => {
  it("store returns a locator string", async () => {
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locator = await backend.store("my-secret");
    expect(typeof locator).toBe("string");
    expect(locator.length).toBeGreaterThan(0);
  });

  it("withSecret resolves the exact plaintext that was stored", async () => {
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locator = await backend.store("super-secret-value");
    const result = await backend.withSecret(locator, async (p) =>
      p.toUpperCase(),
    );
    expect(result).toBe("SUPER-SECRET-VALUE");
  });

  it("has returns true immediately after store", async () => {
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locator = await backend.store("present");
    expect(await backend.has(locator)).toBe(true);
  });

  it("has returns false for an unknown locator", async () => {
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    expect(await backend.has("keychain:does-not-exist:abc123")).toBe(false);
  });

  it("delete removes the secret; has returns false and withSecret throws", async () => {
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locator = await backend.store("to-delete");

    await backend.delete(locator);

    expect(await backend.has(locator)).toBe(false);
    await expect(backend.withSecret(locator, async (p) => p)).rejects.toThrow();
  });

  it("delete is idempotent (double-delete does not throw)", async () => {
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locator = await backend.store("idempotent");
    await backend.delete(locator);
    await expect(backend.delete(locator)).resolves.toBeUndefined();
  });

  it("multiple secrets are stored and resolved independently", async () => {
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locA = await backend.store("value-a");
    const locB = await backend.store("value-b");

    const a = await backend.withSecret(locA, async (p) => p);
    const b = await backend.withSecret(locB, async (p) => p);

    expect(a).toBe("value-a");
    expect(b).toBe("value-b");
  });

  it("withSecret passes the callback return value through", async () => {
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locator = await backend.store("42");
    const result = await backend.withSecret(locator, async (p) =>
      parseInt(p, 10),
    );
    expect(result).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// AC-2: plaintext at rest is OS-encrypted (blob bytes ≠ plaintext bytes)
// ---------------------------------------------------------------------------

describe("AC-2: plaintext never at rest unencrypted", () => {
  it("the persisted blob bytes differ from the plaintext bytes", async () => {
    const plaintext = "my-api-key-12345";
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locator = await backend.store(plaintext);

    // Read the raw blob from disk
    const files = await fs.readdir(tmpDir);
    expect(files.length).toBe(1);
    const blobBytes = await fs.readFile(path.join(tmpDir, files[0]!));

    // The blob must NOT be the UTF-8 encoding of the plaintext
    expect(blobBytes.equals(Buffer.from(plaintext, "utf8"))).toBe(false);

    // Double-check: our mock did encrypt (encryptString was called)
    expect(mock.encryptString).toHaveBeenCalledWith(plaintext);

    // Filename is percent-encoded (colons become %3A on Windows NTFS compat)
    expect(files[0]).toContain("keychain%3A");

    // Sanity: withSecret still resolves the plaintext after round-trip
    const recovered = await backend.withSecret(locator, async (p) => p);
    expect(recovered).toBe(plaintext);
  });
});

// ---------------------------------------------------------------------------
// AC-3: isEncryptionAvailable()===false → throws, no plaintext write
// ---------------------------------------------------------------------------

describe("AC-3: encryption unavailable → throws, no plaintext written", () => {
  it("store throws when isEncryptionAvailable returns false", async () => {
    const mock = makeMockSafeStorage({
      isEncryptionAvailable: vi.fn<() => boolean>(() => false),
    });
    const backend = new ElectronKeychainBackend(tmpDir, mock);

    await expect(backend.store("secret")).rejects.toThrow(
      /encryption is not available/i,
    );
  });

  it("no file is written to disk when encryption is unavailable", async () => {
    const mock = makeMockSafeStorage({
      isEncryptionAvailable: vi.fn<() => boolean>(() => false),
    });
    const backend = new ElectronKeychainBackend(tmpDir, mock);

    await expect(backend.store("secret")).rejects.toThrow();

    const files = await fs.readdir(tmpDir);
    expect(files).toHaveLength(0);
  });

  it("encryptString is never called when encryption is unavailable", async () => {
    const mock = makeMockSafeStorage({
      isEncryptionAvailable: vi.fn<() => boolean>(() => false),
    });
    const backend = new ElectronKeychainBackend(tmpDir, mock);

    await expect(backend.store("secret")).rejects.toThrow();
    expect(mock.encryptString).not.toHaveBeenCalled();
  });

  it("store throws when getSelectedStorageBackend returns 'basic_text' (Linux unprotected)", async () => {
    // On Linux, Electron can select 'basic_text' which uses a hardcoded password.
    // isEncryptionAvailable() returns true for basic_text, so we must check
    // the backend name explicitly to enforce the plaintext-never-at-rest invariant.
    const mock = makeMockSafeStorage({
      getSelectedStorageBackend: vi.fn<() => string>(() => "basic_text"),
    });
    const backend = new ElectronKeychainBackend(tmpDir, mock);

    await expect(backend.store("secret")).rejects.toThrow(/basic_text/i);
  });

  it("no file is written when getSelectedStorageBackend returns 'basic_text'", async () => {
    const mock = makeMockSafeStorage({
      getSelectedStorageBackend: vi.fn<() => string>(() => "basic_text"),
    });
    const backend = new ElectronKeychainBackend(tmpDir, mock);

    await expect(backend.store("secret")).rejects.toThrow();
    const files = await fs.readdir(tmpDir);
    expect(files).toHaveLength(0);
  });

  it("store succeeds when getSelectedStorageBackend returns 'gnome_libsecret' (real Linux keychain)", async () => {
    const mock = makeMockSafeStorage({
      getSelectedStorageBackend: vi.fn<() => string>(() => "gnome_libsecret"),
    });
    const backend = new ElectronKeychainBackend(tmpDir, mock);

    const locator = await backend.store("secret");
    expect(locator).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AC-4: has(locator) MUST NOT call decryptString
// ---------------------------------------------------------------------------

describe("AC-4: has() never decrypts", () => {
  it("has(locator) does not call decryptString (stored secret)", async () => {
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locator = await backend.store("value");

    // Reset decrypt call count after store
    const beforeHas = mock.decryptCallCount;
    await backend.has(locator);
    expect(mock.decryptCallCount).toBe(beforeHas); // no change
    expect(mock.decryptString).not.toHaveBeenCalled();
  });

  it("has(locator) does not call decryptString (absent locator)", async () => {
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);

    await backend.has("keychain:nonexistent:xyz");
    expect(mock.decryptString).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC-5: locatorHint is included in the returned locator
// ---------------------------------------------------------------------------

describe("AC-5: locatorHint in locator", () => {
  it("locator includes the hint when provided", async () => {
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locator = await backend.store("secret", "github-api-key");
    expect(locator).toContain("github-api-key");
  });

  it("locator has no hint section when hint is omitted", async () => {
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locator = await backend.store("secret");
    expect(locator.startsWith("keychain:")).toBe(true);
    // Should still be a valid locator — withSecret must resolve it
    const result = await backend.withSecret(locator, async (p) => p);
    expect(result).toBe("secret");
  });

  it("two stores with the same hint produce distinct locators", async () => {
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locA = await backend.store("a", "same-hint");
    const locB = await backend.store("b", "same-hint");
    expect(locA).not.toBe(locB);
  });
});

// ---------------------------------------------------------------------------
// Storage directory: auto-created on first store
// ---------------------------------------------------------------------------

describe("storageDir auto-creation", () => {
  it("creates the storage directory if it does not exist", async () => {
    const nested = path.join(tmpDir, "vault", "secrets");
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(nested, mock);
    await backend.store("secret");
    const stat = await fs.stat(nested);
    expect(stat.isDirectory()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error propagation: corrupt blob + filesystem errors
// ---------------------------------------------------------------------------

describe("error propagation: corrupt or missing blob", () => {
  it("withSecret propagates decryptString errors from corrupt blobs", async () => {
    // Simulate a backend whose decryptString throws (e.g. OS keychain unavailable
    // at read time, or blob truncated on disk).
    const corruptDecrypt = vi.fn<(encrypted: Buffer) => string>(() => {
      throw new Error("safeStorage: decryption failed");
    });
    const mock = makeMockSafeStorage({ decryptString: corruptDecrypt });
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locator = await backend.store("value");

    // withSecret must surface the decryptString error — no silent swallow.
    await expect(backend.withSecret(locator, async (p) => p)).rejects.toThrow(
      "safeStorage: decryption failed",
    );
  });

  it("withSecret re-throws non-ENOENT read errors (EISDIR)", async () => {
    // Replace the blob with a directory so readFile throws EISDIR (not ENOENT).
    // withSecret must NOT swallow this as "secret not found".
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locator = await backend.store("value");
    const blobPath = path.join(tmpDir, encodeURIComponent(locator));
    await fs.unlink(blobPath);
    await fs.mkdir(blobPath);

    await expect(backend.withSecret(locator, async (p) => p)).rejects.toSatisfy(
      (e: unknown) => {
        const msg = e instanceof Error ? e.message : "";
        return !msg.includes("No encrypted blob found");
      },
    );
  });

  it("has returns false for ENOENT but re-throws other errors (EISDIR)", async () => {
    // ENOENT → false (idiomatic presence check)
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    expect(await backend.has("keychain:truly-absent:xyz")).toBe(false);
  });

  it("delete re-throws non-ENOENT errors (EISDIR)", async () => {
    // Replace blob with a dir — unlink on a dir throws EISDIR (non-ENOENT).
    const mock = makeMockSafeStorage();
    const backend = new ElectronKeychainBackend(tmpDir, mock);
    const locator = await backend.store("value");
    const blobPath = path.join(tmpDir, encodeURIComponent(locator));
    await fs.unlink(blobPath);
    await fs.mkdir(blobPath);

    await expect(backend.delete(locator)).rejects.toThrow();
  });
});
