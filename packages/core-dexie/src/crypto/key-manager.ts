/**
 * Encryption key manager
 *
 * Manages encryption key lifecycle with passphrase-based key derivation.
 * The encryption key is cached in memory only and never persisted.
 * Salt and verifier are stored in IndexedDB for passphrase validation.
 */

import { db } from "../db";
import { deriveKey, encrypt, decrypt, generateSalt } from "./index";

// ============================================================================
// In-Memory Key Cache
// ============================================================================

/**
 * In-memory cache for the derived encryption key.
 * Cleared on page reload or explicit lock.
 */
let cachedKey: CryptoKey | null = null;

// ============================================================================
// Constants
// ============================================================================

/**
 * Known plaintext used to verify passphrase correctness.
 * When unlocking, we decrypt the verifier and check if it matches this value.
 */
const VERIFIER_PLAINTEXT = "dashframe-encryption-verifier";

/**
 * Settings keys for IndexedDB storage
 */
const SETTINGS_KEYS = {
  ENCRYPTION_SALT: "encryption:salt",
  ENCRYPTION_VERIFIER: "encryption:verifier",
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Converts Uint8Array to base64 string for storage
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Converts base64 string back to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * Retrieves salt from IndexedDB settings
 */
async function getSalt(): Promise<Uint8Array | null> {
  // Type assertion: settings table will be added in task 2.2
  const settingsTable = (db as any).settings;
  if (!settingsTable) {
    throw new Error("Settings table not initialized");
  }

  const setting = await settingsTable.get(SETTINGS_KEYS.ENCRYPTION_SALT);
  if (!setting || typeof setting.value !== "string") {
    return null;
  }
  return base64ToUint8Array(setting.value);
}

/**
 * Stores salt in IndexedDB settings
 */
async function storeSalt(salt: Uint8Array): Promise<void> {
  // Type assertion: settings table will be added in task 2.2
  const settingsTable = (db as any).settings;
  if (!settingsTable) {
    throw new Error("Settings table not initialized");
  }

  await settingsTable.put({
    key: SETTINGS_KEYS.ENCRYPTION_SALT,
    value: uint8ArrayToBase64(salt),
  });
}

/**
 * Retrieves verifier from IndexedDB settings
 */
async function getVerifier(): Promise<string | null> {
  // Type assertion: settings table will be added in task 2.2
  const settingsTable = (db as any).settings;
  if (!settingsTable) {
    throw new Error("Settings table not initialized");
  }

  const setting = await settingsTable.get(SETTINGS_KEYS.ENCRYPTION_VERIFIER);
  if (!setting || typeof setting.value !== "string") {
    return null;
  }
  return setting.value;
}

/**
 * Stores verifier in IndexedDB settings
 */
async function storeVerifier(verifier: string): Promise<void> {
  // Type assertion: settings table will be added in task 2.2
  const settingsTable = (db as any).settings;
  if (!settingsTable) {
    throw new Error("Settings table not initialized");
  }

  await settingsTable.put({
    key: SETTINGS_KEYS.ENCRYPTION_VERIFIER,
    value: verifier,
  });
}

/**
 * Validates a passphrase by attempting to decrypt the verifier
 */
async function validatePassphrase(
  key: CryptoKey,
  verifier: string,
): Promise<boolean> {
  try {
    const decrypted = await decrypt(verifier, key);
    return decrypted === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Checks if encryption has been initialized (salt exists)
 *
 * @returns True if encryption has been set up, false otherwise
 *
 * @example
 * const initialized = await isEncryptionInitialized();
 * if (!initialized) {
 *   await initializeEncryption('my-passphrase');
 * }
 */
export async function isEncryptionInitialized(): Promise<boolean> {
  const salt = await getSalt();
  return salt !== null;
}

/**
 * Initializes encryption with a new passphrase.
 * Generates a new salt, derives the encryption key, and stores the verifier.
 *
 * @param passphrase - User-provided passphrase for encryption
 * @throws Error if encryption is already initialized
 *
 * @example
 * await initializeEncryption('my-secure-passphrase');
 */
export async function initializeEncryption(passphrase: string): Promise<void> {
  // Check if already initialized
  const existingSalt = await getSalt();
  if (existingSalt) {
    throw new Error(
      "Encryption is already initialized. Use unlockEncryption() instead.",
    );
  }

  // Validate passphrase
  if (!passphrase || passphrase.trim().length === 0) {
    throw new Error("Passphrase cannot be empty");
  }

  // Generate new salt
  const salt = generateSalt();

  // Derive key from passphrase
  const key = await deriveKey(passphrase, salt);

  // Create verifier by encrypting known plaintext
  const verifier = await encrypt(VERIFIER_PLAINTEXT, key);

  // Store salt and verifier in IndexedDB
  await storeSalt(salt);
  await storeVerifier(verifier);

  // Cache key in memory
  cachedKey = key;
}

/**
 * Unlocks encryption with the user's passphrase.
 * Derives the key from the stored salt and validates against the verifier.
 *
 * @param passphrase - User-provided passphrase
 * @throws Error if encryption is not initialized or passphrase is incorrect
 *
 * @example
 * try {
 *   await unlockEncryption('my-secure-passphrase');
 *   console.log('Encryption unlocked successfully');
 * } catch (error) {
 *   console.error('Invalid passphrase');
 * }
 */
export async function unlockEncryption(passphrase: string): Promise<void> {
  // Load salt from IndexedDB
  const salt = await getSalt();
  if (!salt) {
    throw new Error(
      "Encryption is not initialized. Use initializeEncryption() first.",
    );
  }

  // Load verifier from IndexedDB
  const verifier = await getVerifier();
  if (!verifier) {
    throw new Error("Encryption verifier not found. Database may be corrupted.");
  }

  // Validate passphrase
  if (!passphrase || passphrase.trim().length === 0) {
    throw new Error("Passphrase cannot be empty");
  }

  // Derive key from passphrase
  const key = await deriveKey(passphrase, salt);

  // Validate passphrase by attempting to decrypt verifier
  const isValid = await validatePassphrase(key, verifier);
  if (!isValid) {
    throw new Error("Invalid passphrase");
  }

  // Cache key in memory
  cachedKey = key;
}

/**
 * Checks if encryption is currently unlocked (key is cached in memory)
 *
 * @returns True if encryption key is available, false otherwise
 *
 * @example
 * if (isEncryptionUnlocked()) {
 *   // Can perform encrypted operations
 * } else {
 *   // Need to unlock first
 * }
 */
export function isEncryptionUnlocked(): boolean {
  return cachedKey !== null;
}

/**
 * Gets the cached encryption key
 *
 * @returns The cached CryptoKey
 * @throws Error if encryption is not unlocked
 *
 * @example
 * const key = getEncryptionKey();
 * const encrypted = await encrypt(data, key);
 */
export function getEncryptionKey(): CryptoKey {
  if (!cachedKey) {
    throw new Error(
      "Encryption is locked. Call unlockEncryption() first.",
    );
  }
  return cachedKey;
}

/**
 * Locks encryption by clearing the cached key from memory.
 * The user will need to unlock again with their passphrase.
 *
 * @example
 * lockEncryption();
 * console.log('Encryption locked');
 */
export function lockEncryption(): void {
  cachedKey = null;
}
