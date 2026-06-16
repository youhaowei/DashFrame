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
 *     no sensitive content in the filename). The locator is percent-encoded before
 *     use as a filename to ensure cross-platform compatibility (Windows NTFS
 *     forbids `:` in filenames; macOS/Linux permit it but consistency wins).
 *   - `has(locator)` checks for the file's presence using `fs.access` — NEVER
 *     calls `safeStorage.decryptString`. No decryption happens on this path.
 *   - `withSecret(locator, use)` reads the encrypted blob, decrypts it using
 *     `safeStorage.decryptString`, passes the plaintext to `use`, then lets it
 *     go out of scope. JS cannot zero strings — "scoped" means structurally
 *     un-returnable from `use`.
 *   - If `safeStorage.isEncryptionAvailable()` returns false at store-time, the
 *     operation throws immediately. NO silent plaintext fallback — writing
 *     unencrypted credentials to disk would violate the plaintext-never-at-rest
 *     floor (a strict security invariant for this application).
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
   *                       Pass a mock in tests.
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
   * @returns An opaque locator (opaque string, meaningful only to this backend).
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

    const suffix = crypto.randomUUID();
    const locator = locatorHint
      ? `keychain:${sanitizeHint(locatorHint)}:${suffix}`
      : `keychain:${suffix}`;

    const encrypted = this.#safeStorage.encryptString(plaintext);
    // 0o600: owner read/write only — encrypted blobs should not be world-readable
    // even though their content is OS-encrypted, following least-privilege.
    await fs.writeFile(this.#blobPath(locator), encrypted, { mode: 0o600 });
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
    } catch (err) {
      // Only treat ENOENT as "secret not found" — re-throw EPERM, EIO, etc.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      throw new Error(
        `[keychain-backend] No encrypted blob found at locator "${locator}". ` +
          `The secret may have been deleted or the storage directory moved.`,
        { cause: err },
      );
    }
    const plaintext = this.#safeStorage.decryptString(blob);
    return use(plaintext);
  }

  /**
   * Check presence without decrypting.
   *
   * Uses `fs.access` — only tests file existence, never reads or decrypts.
   * Re-throws filesystem errors other than ENOENT (e.g. EPERM).
   */
  async has(locator: string): Promise<boolean> {
    try {
      await fs.access(this.#blobPath(locator));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  /**
   * Permanently delete the encrypted blob at `locator`.
   * Idempotent: a missing file is treated as success (ENOENT is suppressed).
   * Other errors (EPERM, EBUSY, etc.) are re-thrown.
   */
  async delete(locator: string): Promise<void> {
    try {
      await fs.unlink(this.#blobPath(locator));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // Already absent — idempotent delete succeeds.
    }
  }

  /**
   * Resolve the full on-disk path for a locator.
   *
   * Uses `encodeURIComponent` so colons (present in every locator) are
   * percent-encoded, making filenames valid on Windows NTFS (which forbids `:`).
   */
  #blobPath(locator: string): string {
    return path.join(this.#storageDir, encodeURIComponent(locator));
  }
}

/**
 * Strip characters that are invalid in filenames on any major OS.
 * Keeps the hint human-readable while preventing path traversal.
 */
function sanitizeHint(hint: string): string {
  return hint.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
