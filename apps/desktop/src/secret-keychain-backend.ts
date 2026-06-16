/**
 * ElectronKeychainBackend — a SecretBackend implementation backed by
 * Electron's safeStorage API (OS-level keychain encryption on macOS/Windows/Linux).
 *
 * Design:
 *   - `safeStorage.encryptString` produces an OS-encrypted Buffer that is written
 *     to disk as a binary file under `<storageDir>/`. The raw bytes on disk are
 *     NOT the plaintext — they are OS-encrypted ciphertext. Plaintext-never-at-rest
 *     is enforced at this boundary.
 *   - The `locator` returned by `store()` is the filename under `storageDir`.
 *     It is derived from the optional hint + a random UUID (collision-resistant,
 *     no sensitive content in the filename).
 *   - `has(locator)` checks for the file's presence using `fs.access` — NEVER
 *     calls `safeStorage.decryptString`. No decryption happens on this path.
 *   - `withSecret(locator, use)` reads the encrypted blob, decrypts it using
 *     `safeStorage.decryptString`, passes the plaintext to `use`, then lets it
 *     go out of scope. JS cannot zero strings — "scoped" means structurally
 *     un-returnable from `use`.
 *   - If `safeStorage.isEncryptionAvailable()` returns false at store-time, the
 *     operation throws immediately. NO silent plaintext fallback — writing
 *     unencrypted credentials to disk would violate the plaintext-never-at-rest
 *     floor (YW-239 invariant).
 *
 * Thread safety: each operation is a single awaited fs call; concurrent writes
 * with the same locatorHint produce distinct locators (UUID suffix).
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { SecretBackend } from "@wystack/secret-vault";

/** The safeStorage surface we depend on — extracted for testability. */
export interface SafeStorageSurface {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class ElectronKeychainBackend implements SecretBackend {
  readonly #storageDir: string;
  readonly #safeStorage: SafeStorageSurface;

  /**
   * @param storageDir   - Absolute path to the directory where encrypted blobs
   *                       are stored. Must be inside the app's userData or
   *                       project dir — never hard-coded.
   * @param safeStorage  - The Electron safeStorage object (or a test double).
   *                       Defaults to `require("electron").safeStorage` when not
   *                       provided; pass a mock in tests.
   */
  constructor(storageDir: string, safeStorage: SafeStorageSurface) {
    this.#storageDir = storageDir;
    this.#safeStorage = safeStorage;
  }

  /**
   * Encrypt `plaintext` and persist to disk.
   *
   * Throws if the OS keychain is unavailable — NO silent plaintext fallback.
   *
   * @returns An opaque locator (filename under storageDir).
   */
  async store(plaintext: string, locatorHint?: string): Promise<string> {
    if (!this.#safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "[keychain-backend] safeStorage encryption is not available on this system. " +
          "Cannot store credentials — plaintext-never-at-rest is an invariant. " +
          "Ensure the OS keychain service is running (macOS Keychain, Windows DPAPI, or libsecret on Linux).",
      );
    }

    await fs.mkdir(this.#storageDir, { recursive: true });

    // Locator is a filename, not a path — no path traversal possible.
    const suffix = crypto.randomUUID();
    const locator = locatorHint
      ? `keychain:${sanitizeHint(locatorHint)}:${suffix}`
      : `keychain:${suffix}`;

    const encrypted = this.#safeStorage.encryptString(plaintext);
    await fs.writeFile(this.#blobPath(locator), encrypted);
    return locator;
  }

  /**
   * Decrypt the stored blob and call `use` with the plaintext.
   * Plaintext is scoped to the callback — structurally un-returnable.
   */
  async withSecret<T>(
    locator: string,
    use: (plaintext: string) => Promise<T>,
  ): Promise<T> {
    const blobPath = this.#blobPath(locator);
    let blob: Buffer;
    try {
      blob = await fs.readFile(blobPath);
    } catch {
      throw new Error(
        `[keychain-backend] No encrypted blob found at locator "${locator}". ` +
          `The secret may have been deleted or the storage directory moved.`,
      );
    }
    const plaintext = this.#safeStorage.decryptString(blob);
    return use(plaintext);
  }

  /**
   * Check presence without decrypting.
   *
   * Uses `fs.access` — only tests file existence, never reads or decrypts.
   */
  async has(locator: string): Promise<boolean> {
    try {
      await fs.access(this.#blobPath(locator));
      return true;
    } catch {
      return false;
    }
  }

  /** Permanently delete the encrypted blob at `locator`. */
  async delete(locator: string): Promise<void> {
    try {
      await fs.unlink(this.#blobPath(locator));
    } catch {
      // Already absent — treat as success (idempotent delete).
    }
  }

  /** Resolve the full on-disk path for a locator. */
  #blobPath(locator: string): string {
    // Replace any path-separator characters in the locator to keep it a simple filename.
    const filename = locator.replace(/[/\\]/g, "_");
    return path.join(this.#storageDir, filename);
  }
}

/**
 * Strip characters that are invalid in filenames on any major OS.
 * Keeps the hint human-readable while preventing path traversal.
 */
function sanitizeHint(hint: string): string {
  return hint.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
