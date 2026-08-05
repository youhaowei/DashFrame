/**
 * EncryptedFileSecretBackend — AES-256-GCM SecretBackend for `dashframe serve`.
 *
 * Threat boundary: this protects secrets from at-rest disclosure (for example,
 * a stolen disk, leaked backup, or an actor who can read host files without
 * executing as the same OS user). It does NOT protect against a same-account
 * runtime attacker who can already read the key file or this process's memory.
 *
 * Single-writer assumption: the standalone server is the only writer. This
 * pilot does not implement cross-process locking; concurrent writers forced to
 * target the same locator could race.
 *
 * Backend registration name: `dashframe-encrypted-file`. That name is
 * persisted in vault mappings and must NEVER change once secrets may exist
 * under it. Namespaced under `dashframe-` because the blob format (`DFSB`
 * magic) is DashFrame-specific — a future WyStack-provided backend with a
 * different envelope must not be able to collide on the same registration
 * name.
 *
 * Blob format (all lengths are bytes):
 *   magic[4] | version[1] | keyIdLength[1] | locatorLength[1] |
 *   nonce[12] | authTag[16] | keyId | locator | ciphertext
 *
 * AAD authenticates the format version, key ID, caller-supplied locator, and
 * envelope locator. This rejects metadata edits and blob swaps between paths.
 * Rotation: construct with the new active key plus retired keys in `keys`
 * (see `loadSecretKeyring`'s DASHFRAME_SECRET_KEY_PREVIOUS) — old blobs are
 * read by their recorded key ID; only `activeKeyId` is ever used for new
 * writes.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { Stats } from "node:fs";
import { constants } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";

import type { SecretBackend } from "@wystack/secret-vault";

const ALGORITHM = "aes-256-gcm";
const FORMAT_VERSION = 1;
const MAGIC = Buffer.from("DFSB", "ascii");
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const LOCATOR_PATTERN = /^[a-f0-9]{32}$/;
const KEY_ID_PATTERN = /^[a-f0-9]{16}$/;
const BASE64_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const AAD_DOMAIN = Buffer.from("dashframe-secret-blob", "ascii");

export const ENCRYPTED_FILE_BACKEND_NAME = "dashframe-encrypted-file";

export interface SecretKeyringConfig {
  activeKeyId: string;
  keys: Map<string, Buffer>;
}

interface FileSystemSurface {
  mkdir(
    targetPath: string,
    options: { recursive: true; mode?: number },
  ): Promise<string | undefined>;
  lstat(targetPath: string): Promise<Stats>;
  readFile(targetPath: string): Promise<Buffer>;
  open(
    targetPath: string,
    flags: string | number,
    mode?: number,
  ): Promise<FileHandle>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(targetPath: string): Promise<void>;
}

interface CryptoSurface {
  randomBytes(size: number): Buffer;
  encrypt(
    key: Buffer,
    nonce: Buffer,
    plaintext: string,
    aad: Buffer,
  ): { ciphertext: Buffer; authTag: Buffer };
  decrypt(
    key: Buffer,
    nonce: Buffer,
    ciphertext: Buffer,
    authTag: Buffer,
    aad: Buffer,
  ): string;
}

export interface EncryptedFileSecretBackendDependencies {
  fs?: Partial<FileSystemSurface>;
  crypto?: Partial<CryptoSurface>;
}

const defaultFileSystem: FileSystemSurface = {
  mkdir: (targetPath, options) => fs.mkdir(targetPath, options),
  lstat: (targetPath) => fs.lstat(targetPath),
  readFile: (targetPath) => fs.readFile(targetPath),
  open: (targetPath, flags, mode) => fs.open(targetPath, flags, mode),
  rename: (oldPath, newPath) => fs.rename(oldPath, newPath),
  unlink: (targetPath) => fs.unlink(targetPath),
};

const defaultCrypto: CryptoSurface = {
  randomBytes,
  encrypt(key, nonce, plaintext, aad) {
    const cipher = createCipheriv(ALGORITHM, key, nonce, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return { ciphertext, authTag: cipher.getAuthTag() };
  },
  decrypt(key, nonce, ciphertext, authTag, aad) {
    const decipher = createDecipheriv(ALGORITHM, key, nonce, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  },
};

/**
 * AES-256-GCM encrypted-file backend registered permanently as
 * `dashframe-encrypted-file`; that registration name must NEVER change once
 * secrets may exist under it.
 */
export class EncryptedFileSecretBackend implements SecretBackend {
  readonly #storageDir: string;
  readonly #activeKeyId: string;
  readonly #keys: Map<string, Buffer>;
  readonly #fs: FileSystemSurface;
  readonly #crypto: CryptoSurface;

  constructor(
    storageDir: string,
    keyring: SecretKeyringConfig,
    dependencies: EncryptedFileSecretBackendDependencies = {},
  ) {
    this.#storageDir = storageDir;
    this.#keys = validateKeyring(keyring);
    this.#activeKeyId = keyring.activeKeyId;
    this.#fs = { ...defaultFileSystem, ...dependencies.fs };
    this.#crypto = { ...defaultCrypto, ...dependencies.crypto };
  }

  async store(plaintext: string, _locatorHint?: string): Promise<string> {
    await this.#ensureStorageDirectory();

    const locator = this.#crypto.randomBytes(16).toString("hex");
    validateLocator(locator);
    const target = this.#blobPath(locator);
    await this.#assertUnusedWriteTarget(target);

    const key = this.#keys.get(this.#activeKeyId)!;
    const nonce = this.#crypto.randomBytes(NONCE_LENGTH);
    if (nonce.length !== NONCE_LENGTH) {
      throw new Error(
        "[encrypted-file] Random nonce source returned the wrong length",
      );
    }
    const aad = buildAad(FORMAT_VERSION, this.#activeKeyId, locator, locator);
    const { ciphertext, authTag } = this.#crypto.encrypt(
      key,
      nonce,
      plaintext,
      aad,
    );
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(
        "[encrypted-file] AES-GCM returned an invalid authentication tag",
      );
    }
    const blob = encodeEnvelope({
      version: FORMAT_VERSION,
      keyId: this.#activeKeyId,
      locator,
      nonce,
      authTag,
      ciphertext,
    });

    const temporary = path.join(
      this.#storageDir,
      `.blob.${this.#crypto.randomBytes(16).toString("hex")}.tmp`,
    );
    let handle: FileHandle | undefined;
    let renamed = false;
    try {
      handle = await this.#fs.open(temporary, "wx", 0o600);
      await handle.writeFile(blob);
      await handle.sync();
      await handle.close();
      handle = undefined;

      await this.#fs.rename(temporary, target);
      renamed = true;
      await this.#syncDirectory();
      return locator;
    } catch (error) {
      // Cleanup failures here must never replace `error` — the caller needs
      // the real store failure (disk full, permission denied), not whatever
      // secondary error a best-effort unlink produced.
      await handle?.close().catch(() => undefined);
      await this.#fs.unlink(temporary).catch(() => undefined);
      if (renamed) {
        await this.#fs.unlink(target).catch(() => undefined);
      }
      throw error;
    }
  }

  async withSecret<T>(
    locator: string,
    use: (plaintext: string) => Promise<T>,
  ): Promise<T> {
    validateLocator(locator);
    const target = this.#blobPath(locator);
    const stat = await this.#lstatBlob(target);
    assertRegularFile(stat, target);

    const envelope = decodeEnvelope(await this.#fs.readFile(target));
    // Checked before decrypt: a future-version blob (or one from a key we no
    // longer hold) should reject cleanly without materializing plaintext.
    if (envelope.version !== FORMAT_VERSION) {
      throw new Error(
        `[encrypted-file] Unsupported encrypted blob version ${envelope.version}`,
      );
    }
    const key = this.#keys.get(envelope.keyId);
    if (!key) {
      // Never interpolate keyId (a truncated hash of key material) into an
      // error string that can reach a remote caller.
      throw new Error(
        "[encrypted-file] Blob was written under a key that is not present in the configured keyring",
      );
    }
    // No separate `envelope.locator !== locator` check: both locators are
    // bound into the AAD below, so any mismatch already fails AEAD
    // authentication before this point could ever be reached.
    const aad = buildAad(
      envelope.version,
      envelope.keyId,
      locator,
      envelope.locator,
    );
    const plaintext = this.#crypto.decrypt(
      key,
      envelope.nonce,
      envelope.ciphertext,
      envelope.authTag,
      aad,
    );
    return use(plaintext);
  }

  /** Presence check only: lstat validates existence/type and never reads or decrypts. */
  async has(locator: string): Promise<boolean> {
    validateLocator(locator);
    const target = this.#blobPath(locator);
    try {
      const stat = await this.#fs.lstat(target);
      assertRegularFile(stat, target);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  async delete(locator: string): Promise<void> {
    validateLocator(locator);
    try {
      await this.#fs.unlink(this.#blobPath(locator));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  #blobPath(locator: string): string {
    return path.join(this.#storageDir, locator);
  }

  async #ensureStorageDirectory(): Promise<void> {
    await this.#fs.mkdir(this.#storageDir, { recursive: true, mode: 0o700 });
    const stat = await this.#fs.lstat(this.#storageDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(
        `[encrypted-file] Storage path is not a real directory: ${this.#storageDir}`,
      );
    }
    // `mode: 0o700` above only applies on creation. A pre-existing directory
    // (operator-created data dir, restored backup) could be group/world
    // writable, which would let another local user unlink or replace blobs —
    // exactly what the symlink defenses elsewhere in this class exist to
    // prevent. Mirror the same check `assertSecureKeyFile` applies to the key
    // file.
    if ((stat.mode & 0o077) !== 0) {
      throw new Error(
        `[encrypted-file] Storage directory must have mode 0700 (group/world permissions are forbidden): ${this.#storageDir}`,
      );
    }
  }

  async #assertUnusedWriteTarget(target: string): Promise<void> {
    try {
      const stat = await this.#fs.lstat(target);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `[encrypted-file] Refusing to write through a symbolic link: ${target}`,
        );
      }
      throw new Error(
        `[encrypted-file] Refusing to overwrite existing blob: ${target}`,
      );
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }

  async #lstatBlob(target: string): Promise<Stats> {
    try {
      return await this.#fs.lstat(target);
    } catch (error) {
      if (!isMissing(error)) throw error;
      // The locator is deliberately NOT interpolated. These errors surface
      // through RPC handlers to a remote caller, and a locator is a live
      // handle to a stored secret — echoing it back turns a failed lookup
      // into an oracle that confirms and reflects vault handles. `cause`
      // keeps the underlying ENOENT for local debugging.
      throw new Error("[encrypted-file] No encrypted blob found for locator", {
        cause: error,
      });
    }
  }

  /**
   * Best-effort fsync of the directory entry after the rename.
   *
   * Deliberately non-throwing. The blob's own contents are already fsynced
   * BEFORE the rename, so this step only hardens the durability of the
   * directory entry itself — it is not required for the stored secret to be
   * correct or readable. Some platforms and filesystems (notably several
   * Windows filesystems) refuse to open a directory for reading at all, which
   * would make this throw on a store that has already fully succeeded. Letting
   * that escape would take the caller down the rollback path below and unlink
   * a blob that is durably on disk — turning a portability quirk into silent
   * secret loss. Fail quiet instead.
   */
  async #syncDirectory(): Promise<void> {
    try {
      const directory = await this.#fs.open(this.#storageDir, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch {
      // Best-effort only — see above.
    }
  }
}

interface BlobEnvelope {
  version: number;
  keyId: string;
  locator: string;
  nonce: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}

function encodeEnvelope(envelope: BlobEnvelope): Buffer {
  const keyId = Buffer.from(envelope.keyId, "ascii");
  const locator = Buffer.from(envelope.locator, "ascii");
  return Buffer.concat([
    MAGIC,
    Buffer.from([envelope.version, keyId.length, locator.length]),
    envelope.nonce,
    envelope.authTag,
    keyId,
    locator,
    envelope.ciphertext,
  ]);
}

function decodeEnvelope(blob: Buffer): BlobEnvelope {
  const fixedLength = MAGIC.length + 3 + NONCE_LENGTH + AUTH_TAG_LENGTH;
  if (
    blob.length < fixedLength ||
    !blob.subarray(0, MAGIC.length).equals(MAGIC)
  ) {
    throw new Error("[encrypted-file] Invalid encrypted blob envelope");
  }
  const version = blob[MAGIC.length]!;
  const keyIdLength = blob[MAGIC.length + 1]!;
  const locatorLength = blob[MAGIC.length + 2]!;
  const metadataEnd = fixedLength + keyIdLength + locatorLength;
  if (metadataEnd > blob.length) {
    throw new Error("[encrypted-file] Truncated encrypted blob envelope");
  }

  const nonceStart = MAGIC.length + 3;
  const tagStart = nonceStart + NONCE_LENGTH;
  const keyIdStart = tagStart + AUTH_TAG_LENGTH;
  const locatorStart = keyIdStart + keyIdLength;
  const keyId = blob.subarray(keyIdStart, locatorStart).toString("ascii");
  const locator = blob.subarray(locatorStart, metadataEnd).toString("ascii");
  if (!KEY_ID_PATTERN.test(keyId) || !LOCATOR_PATTERN.test(locator)) {
    throw new Error("[encrypted-file] Invalid encrypted blob metadata");
  }

  return {
    version,
    keyId,
    locator,
    nonce: blob.subarray(nonceStart, tagStart),
    authTag: blob.subarray(tagStart, keyIdStart),
    ciphertext: blob.subarray(metadataEnd),
  };
}

function buildAad(
  version: number,
  keyId: string,
  requestedLocator: string,
  envelopeLocator: string,
): Buffer {
  const keyIdBytes = Buffer.from(keyId, "ascii");
  const requestedBytes = Buffer.from(requestedLocator, "ascii");
  const envelopeBytes = Buffer.from(envelopeLocator, "ascii");
  return Buffer.concat([
    AAD_DOMAIN,
    Buffer.from([
      version,
      keyIdBytes.length,
      requestedBytes.length,
      envelopeBytes.length,
    ]),
    keyIdBytes,
    requestedBytes,
    envelopeBytes,
  ]);
}

function validateKeyring(config: SecretKeyringConfig): Map<string, Buffer> {
  if (!config.keys.has(config.activeKeyId)) {
    throw new Error(
      "[encrypted-file] Active key ID is missing from the keyring",
    );
  }
  const validated = new Map<string, Buffer>();
  for (const [keyId, key] of config.keys) {
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new Error(`[encrypted-file] Invalid key ID "${keyId}"`);
    }
    if (key.length !== 32) {
      throw new Error(
        `[encrypted-file] Key "${keyId}" must decode to exactly 32 bytes for AES-256-GCM`,
      );
    }
    if (deriveKeyId(key) !== keyId) {
      throw new Error(
        `[encrypted-file] Key ID "${keyId}" does not match its key material`,
      );
    }
    validated.set(keyId, Buffer.from(key));
  }
  return validated;
}

function validateLocator(locator: string): void {
  if (!LOCATOR_PATTERN.test(locator)) {
    // Locator not interpolated — see `#lstatBlob`. A rejected locator is
    // attacker-supplied by definition on this path, so reflecting it back
    // would also make this a trivial echo surface.
    throw new Error("[encrypted-file] Invalid secret locator");
  }
}

function assertRegularFile(stat: Stats, target: string): void {
  if (stat.isSymbolicLink()) {
    throw new Error(
      `[encrypted-file] Refusing to follow symbolic link: ${target}`,
    );
  }
  if (!stat.isFile()) {
    throw new Error(
      `[encrypted-file] Encrypted blob is not a regular file: ${target}`,
    );
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function deriveKeyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/**
 * Load the active AES key, plus any retired keys kept for rotation, from the
 * standalone-server environment.
 *
 * Both DASHFRAME_SECRET_KEY and DASHFRAME_SECRET_KEY_FILE contain canonical,
 * padded RFC 4648 base64 encoding of exactly 32 bytes. Key files may end in one
 * newline and must be a non-symlinked regular file with mode 0600.
 *
 * DASHFRAME_SECRET_KEY_PREVIOUS is an optional comma-separated list of
 * additional keys in the same encoding, retained only to decrypt blobs
 * written under a key that is no longer active. New writes never use these.
 * This is the operator-facing rotation path: to rotate, generate a new key,
 * set it as DASHFRAME_SECRET_KEY, and move the old value into
 * DASHFRAME_SECRET_KEY_PREVIOUS so existing blobs stay readable. Dropping a
 * key from this list permanently loses access to any blob still encrypted
 * under it.
 */
export async function loadSecretKeyring(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<SecretKeyringConfig | undefined> {
  const keyFile = environment.DASHFRAME_SECRET_KEY_FILE;
  const inlineKey = environment.DASHFRAME_SECRET_KEY;
  const hasKeyFile = keyFile !== undefined;
  const hasInlineKey = inlineKey !== undefined;
  if (hasKeyFile && hasInlineKey) {
    throw new Error(
      "Set only one of DASHFRAME_SECRET_KEY_FILE or DASHFRAME_SECRET_KEY",
    );
  }
  if (!hasKeyFile && !hasInlineKey) return undefined;
  if (hasKeyFile && keyFile.length === 0) {
    throw new Error("DASHFRAME_SECRET_KEY_FILE must not be empty");
  }

  const encoded = hasKeyFile
    ? await readKeyFile(keyFile as string)
    : (inlineKey as string);
  const key = decodeKey(
    encoded,
    hasKeyFile ? "secret key file" : "DASHFRAME_SECRET_KEY",
  );
  const activeKeyId = deriveKeyId(key);
  const keys = new Map([[activeKeyId, key]]);

  const previous = environment.DASHFRAME_SECRET_KEY_PREVIOUS;
  if (previous !== undefined && previous.length > 0) {
    const entries = previous.split(",").map((entry) => entry.trim());
    for (const [index, entry] of entries.entries()) {
      if (entry.length === 0) {
        throw new Error(
          `DASHFRAME_SECRET_KEY_PREVIOUS entry ${index + 1} is empty`,
        );
      }
      const previousKey = decodeKey(
        entry,
        `DASHFRAME_SECRET_KEY_PREVIOUS entry ${index + 1}`,
      );
      keys.set(deriveKeyId(previousKey), previousKey);
    }
  }

  return { activeKeyId, keys };
}

async function readKeyFile(filePath: string): Promise<string> {
  let beforeOpen: Stats;
  try {
    beforeOpen = await fs.lstat(filePath);
  } catch (error) {
    if (isMissing(error)) {
      throw new Error(`Secret key file does not exist: ${filePath}`, {
        cause: error,
      });
    }
    throw error;
  }
  assertSecureKeyFile(beforeOpen, filePath);

  const handle = await fs.open(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    assertSecureKeyFile(await handle.stat(), filePath);
    const contents = await handle.readFile("utf8");
    return contents.replace(/\r?\n$/, "");
  } finally {
    await handle.close();
  }
}

function assertSecureKeyFile(stat: Stats, filePath: string): void {
  if (stat.isSymbolicLink()) {
    throw new Error(`Secret key file must not be a symbolic link: ${filePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Secret key path is not a regular file: ${filePath}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(
      `Secret key file must have mode 0600 (group/world permissions are forbidden): ${filePath}`,
    );
  }
}

function decodeKey(encoded: string, source: string): Buffer {
  if (!BASE64_KEY_PATTERN.test(encoded)) {
    throw new Error(
      `${source} must be canonical padded base64 encoding of exactly 32 bytes`,
    );
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error(`${source} must decode to exactly 32 bytes`);
  }
  return key;
}
