/**
 * Crypto utilities for encrypting/decrypting sensitive data using Web Crypto API
 *
 * Uses AES-256-GCM for authenticated encryption and PBKDF2 for key derivation.
 * All functions are async and use the Web Crypto API (no external dependencies).
 */

/**
 * Generates a random salt for key derivation
 *
 * @returns 16-byte Uint8Array salt
 *
 * @example
 * const salt = generateSalt();
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * Derives an encryption key from a passphrase using PBKDF2
 *
 * @param passphrase - User-provided passphrase
 * @param salt - 16-byte salt (from generateSalt)
 * @returns CryptoKey suitable for AES-GCM encryption
 *
 * @example
 * const salt = generateSalt();
 * const key = await deriveKey('my-secure-passphrase', salt);
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  // Convert passphrase to key material
  const encoder = new TextEncoder();
  const passphraseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive AES-GCM key using PBKDF2 with 100,000 iterations and SHA-256
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    passphraseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts plaintext using AES-256-GCM
 *
 * @param plaintext - Text to encrypt
 * @param key - CryptoKey from deriveKey()
 * @returns Base64-encoded string containing IV + ciphertext + auth tag
 *
 * @example
 * const key = await deriveKey('passphrase', salt);
 * const encrypted = await encrypt('secret-api-key', key);
 */
export async function encrypt(
  plaintext: string,
  key: CryptoKey
): Promise<string> {
  // Generate random 12-byte IV for AES-GCM
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt the plaintext
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    encoder.encode(plaintext)
  );

  // Combine IV + ciphertext (ciphertext already includes 16-byte auth tag)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  // Encode to base64
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts ciphertext using AES-256-GCM
 *
 * @param ciphertext - Base64-encoded string from encrypt()
 * @param key - CryptoKey from deriveKey()
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (wrong key or corrupted data)
 *
 * @example
 * const key = await deriveKey('passphrase', salt);
 * const decrypted = await decrypt(encrypted, key);
 */
export async function decrypt(
  ciphertext: string,
  key: CryptoKey
): Promise<string> {
  // Decode from base64
  const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));

  // Extract IV (first 12 bytes) and ciphertext (remaining bytes)
  const iv = combined.slice(0, 12);
  const encryptedData = combined.slice(12);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    encryptedData
  );

  // Decode to string
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}
