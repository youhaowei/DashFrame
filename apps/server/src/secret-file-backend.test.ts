/**
 * EncryptedFileSecretBackend acceptance tests.
 *
 *   AC-1  round-trip / presence / deletion / callback passthrough
 *   AC-2  plaintext never rests on disk
 *   AC-3  has() never decrypts
 *   AC-4  locator and symlink defenses
 *   AC-5  authenticated-envelope tamper detection
 *   AC-6  startup key validation
 *   AC-7  keyring rotation behavior
 *   AC-8  durable atomic-write cleanup
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deriveKeyId,
  ENCRYPTED_FILE_BACKEND_NAME,
  EncryptedFileSecretBackend,
  loadSecretKeyring,
  type SecretKeyringConfig,
} from "./secret-file-backend";

const HEADER = {
  version: 4,
  authTag: 19,
  keyId: 35,
  locator: 51,
  ciphertext: 83,
} as const;

let root: string;
let blobs: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "encrypted-file-test-"));
  blobs = path.join(root, "blobs");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function key(fill: number): Buffer {
  return Buffer.alloc(32, fill);
}

function keyring(active: Buffer, old: Buffer[] = []): SecretKeyringConfig {
  const entries = [active, ...old].map(
    (material) => [deriveKeyId(material), material] as const,
  );
  return { activeKeyId: deriveKeyId(active), keys: new Map(entries) };
}

function backend(config = keyring(key(1))): EncryptedFileSecretBackend {
  return new EncryptedFileSecretBackend(blobs, config);
}

async function rawBlob(locator: string): Promise<Buffer> {
  return fs.readFile(path.join(blobs, locator));
}

async function rewriteBlob(
  locator: string,
  mutate: (blob: Buffer) => void,
): Promise<void> {
  const target = path.join(blobs, locator);
  const blob = await fs.readFile(target);
  mutate(blob);
  await fs.writeFile(target, blob, { mode: 0o600 });
}

describe("AC-1: round-trip (store → withSecret → has → delete)", () => {
  it("returns a fixed-grammar opaque locator", async () => {
    expect(await backend().store("secret")).toMatch(/^[a-f0-9]{32}$/);
  });

  it("returns the exact stored plaintext", async () => {
    const subject = backend();
    const locator = await subject.store("super-secret-value");
    await expect(
      subject.withSecret(locator, async (value) => value),
    ).resolves.toBe("super-secret-value");
  });

  it("passes a generic callback return value through", async () => {
    const subject = backend();
    const locator = await subject.store("42");
    await expect(
      subject.withSecret(locator, async (value) => Number(value)),
    ).resolves.toBe(42);
  });

  it("reports present and absent locators correctly", async () => {
    const subject = backend();
    const locator = await subject.store("present");
    expect(await subject.has(locator)).toBe(true);
    expect(await subject.has("a".repeat(32))).toBe(false);
  });

  it("deletes a blob and rejects subsequent reads", async () => {
    const subject = backend();
    const locator = await subject.store("remove-me");
    await subject.delete(locator);
    expect(await subject.has(locator)).toBe(false);
    await expect(
      subject.withSecret(locator, async (value) => value),
    ).rejects.toThrow(/No encrypted blob found/);
  });

  it("makes delete idempotent", async () => {
    const subject = backend();
    const locator = await subject.store("remove-me");
    await subject.delete(locator);
    await expect(subject.delete(locator)).resolves.toBeUndefined();
  });

  it("keeps multiple secrets independent", async () => {
    const subject = backend();
    const first = await subject.store("first");
    const second = await subject.store("second");
    expect(first).not.toBe(second);
    await expect(
      subject.withSecret(first, async (value) => value),
    ).resolves.toBe("first");
    await expect(
      subject.withSecret(second, async (value) => value),
    ).resolves.toBe("second");
  });

  it("does not expose locatorHint content in the opaque locator", async () => {
    const locator = await backend().store("secret", "customer-name-api-key");
    expect(locator).not.toContain("customer-name");
    expect(locator).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("AC-2: plaintext never at rest", () => {
  it("persists blob bytes that differ from plaintext bytes", async () => {
    const plaintext = "my-api-key-12345";
    const subject = backend();
    const locator = await subject.store(plaintext);
    // `includes` subsumes `equals` here — a blob equal to the plaintext would
    // also contain it.
    expect(
      (await rawBlob(locator)).includes(Buffer.from(plaintext, "utf8")),
    ).toBe(false);
  });

  it("keeps plaintext out of the locator, the temp file, and the directory listing", async () => {
    const plaintext = "another-api-key-98765";
    const subject = backend();
    const locator = await subject.store(plaintext, plaintext);
    expect(locator).not.toContain(plaintext);
    for (const entry of await fs.readdir(blobs)) {
      expect(entry).not.toContain(plaintext);
      expect(
        (await fs.readFile(path.join(blobs, entry))).includes(
          Buffer.from(plaintext, "utf8"),
        ),
      ).toBe(false);
    }
  });

  it("keeps plaintext out of a failed store (nothing is left on disk)", async () => {
    const plaintext = "never-persisted-99999";
    const subject = new EncryptedFileSecretBackend(blobs, keyring(key(1)), {
      fs: {
        rename: vi.fn(async () => {
          throw new Error("simulated rename failure");
        }),
      },
    });
    await expect(subject.store(plaintext)).rejects.toThrow(
      "simulated rename failure",
    );
    expect(await fs.readdir(blobs)).toEqual([]);
  });

  it("uses a fresh 12-byte nonce so identical plaintexts encrypt differently", async () => {
    const subject = backend();
    const first = await rawBlob(await subject.store("same-plaintext"));
    const second = await rawBlob(await subject.store("same-plaintext"));
    const firstNonce = first.subarray(7, 19);
    const secondNonce = second.subarray(7, 19);
    expect(firstNonce).toHaveLength(12);
    expect(secondNonce).toHaveLength(12);
    expect(firstNonce.equals(secondNonce)).toBe(false);
  });

  it("creates the storage directory 0700 and a mode-0600 blob", async () => {
    const subject = backend();
    const locator = await subject.store("secret");
    const directory = await fs.stat(blobs);
    expect(directory.isDirectory()).toBe(true);
    expect(directory.mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(blobs, locator))).mode & 0o777).toBe(0o600);
  });

  it("refuses a pre-existing group/world-accessible storage directory", async () => {
    // `mode: 0o700` only applies on creation. An operator-created data dir or a
    // restored backup can be group-writable, which would let another local user
    // unlink or replace blobs.
    await fs.mkdir(blobs, { recursive: true, mode: 0o700 });
    // eslint-disable-next-line sonarjs/file-permissions -- deliberately insecure mode under test
    await fs.chmod(blobs, 0o755);
    await expect(backend().store("secret")).rejects.toThrow(
      /must not be group- or world-accessible/,
    );
  });

  it("refuses a symlinked storage directory", async () => {
    const real = path.join(root, "elsewhere");
    await fs.mkdir(real, { mode: 0o700 });
    await fs.symlink(real, blobs);
    await expect(backend().store("secret")).rejects.toThrow(
      /Storage path is not a real directory/,
    );
    expect(await fs.readdir(real)).toEqual([]);
  });
});

describe("on-disk contract (frozen once blobs exist)", () => {
  it("pins the backend registration name", () => {
    // Persisted in vault mappings — changing it orphans every stored secret.
    expect(ENCRYPTED_FILE_BACKEND_NAME).toBe("dashframe-encrypted-file");
  });

  it("pins the envelope layout byte-for-byte", async () => {
    // magic[4] | version[1] | keyIdLength[1] | locatorLength[1] |
    // nonce[12] | authTag[16] | keyId[16] | locator[32] | ciphertext
    const plaintext = "layout-probe";
    const locator = await backend().store(plaintext);
    const blob = await rawBlob(locator);

    expect(blob.subarray(0, 4).toString("ascii")).toBe("DFSB");
    expect(blob[4]).toBe(1);
    expect(blob[5]).toBe(16);
    expect(blob[6]).toBe(32);
    expect(blob.subarray(HEADER.keyId, HEADER.locator).toString("ascii")).toBe(
      deriveKeyId(key(1)),
    );
    expect(
      blob.subarray(HEADER.locator, HEADER.ciphertext).toString("ascii"),
    ).toBe(locator);
    // GCM ciphertext is the same length as the plaintext; the tag lives in the
    // fixed header, not appended.
    expect(blob).toHaveLength(HEADER.ciphertext + plaintext.length);
  });

  it("pins the key-ID derivation as domain-separated, not a bare key hash", async () => {
    // Recorded in every blob and bound into the AAD — this derivation can never
    // change once blobs exist.
    const material = key(1);
    expect(deriveKeyId(material)).toBe(
      createHash("sha256")
        .update(Buffer.from("dashframe-secret-key-id\0", "ascii"))
        .update(material)
        .digest("hex")
        .slice(0, 16),
    );
    expect(deriveKeyId(material)).not.toBe(
      createHash("sha256").update(material).digest("hex").slice(0, 16),
    );
  });

  it("rejects a blob claiming a future format version", async () => {
    const locator = await backend().store("future");
    await rewriteBlob(locator, (blob) => {
      blob[HEADER.version] = 2;
    });
    await expect(
      backend().withSecret(locator, async (value) => value),
    ).rejects.toThrow(/Unsupported encrypted blob version 2/);
  });
});

describe("AC-3: has() never decrypts", () => {
  it("never reads blob contents for present or absent locators", async () => {
    // AES-GCM is not an injectable seam (see `CryptoSurface`), so this pins the
    // stronger precondition instead: `has()` never reads the file at all, and
    // what is never read can never be decrypted.
    const written = await backend().store("secret");
    const readFile = vi.fn(async () => {
      throw new Error("has() must not read blob contents");
    });
    const subject = new EncryptedFileSecretBackend(blobs, keyring(key(1)), {
      fs: { readFile },
    });

    expect(await subject.has(written)).toBe(true);
    expect(await subject.has("b".repeat(32))).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("returns false, rather than throwing, for an unusable entry", async () => {
    // `has()` runs in a loop over every stored credential during
    // authentication. One poisoned entry must mean "this one is unusable", not
    // "authentication fails for everybody". The read path still fails loudly on
    // the same entry — proven below.
    await fs.mkdir(blobs, { recursive: true, mode: 0o700 });
    const symlinked = "a".repeat(32);
    const outside = path.join(root, "outside");
    await fs.writeFile(outside, "not-a-secret", { mode: 0o600 });
    await fs.symlink(outside, path.join(blobs, symlinked));

    const wideOpen = "b".repeat(32);
    await fs.writeFile(path.join(blobs, wideOpen), "irrelevant", {
      mode: 0o600,
    });
    // eslint-disable-next-line sonarjs/file-permissions -- deliberately insecure mode under test
    await fs.chmod(path.join(blobs, wideOpen), 0o644);

    const directory = "c".repeat(32);
    await fs.mkdir(path.join(blobs, directory), { mode: 0o700 });

    const subject = backend();
    expect(await subject.has(symlinked)).toBe(false);
    expect(await subject.has(wideOpen)).toBe(false);
    expect(await subject.has(directory)).toBe(false);

    // Same entries, read path: every one is still a hard failure. `has()`
    // downgrading these to "unusable" must never mean the read path will hand
    // the value over.
    await expect(
      subject.withSecret(symlinked, async (value) => value),
    ).rejects.toThrow(/Refusing to follow symbolic link/);
    await expect(
      subject.withSecret(wideOpen, async (value) => value),
    ).rejects.toThrow(/must not be group- or world-accessible/);
    await expect(
      subject.withSecret(directory, async (value) => value),
    ).rejects.toThrow(/not a regular file/);
  });
});

describe("AC-4: locator validation and symlink defense", () => {
  it.each([
    "../../etc/passwd",
    "/etc/passwd",
    "..\\..\\windows\\system32",
    "a".repeat(31),
    "g".repeat(32),
    `abc\0${"a".repeat(28)}`,
  ])(
    "rejects malformed locator %j before filesystem access",
    async (locator) => {
      const lstat = vi.fn();
      const readFile = vi.fn();
      const unlink = vi.fn();
      const subject = new EncryptedFileSecretBackend(blobs, keyring(key(1)), {
        fs: { lstat, readFile, unlink },
      });

      await expect(subject.has(locator)).rejects.toThrow(
        /Invalid secret locator/,
      );
      await expect(
        subject.withSecret(locator, async (value) => value),
      ).rejects.toThrow(/Invalid secret locator/);
      await expect(subject.delete(locator)).rejects.toThrow(
        /Invalid secret locator/,
      );
      expect(lstat).not.toHaveBeenCalled();
      expect(readFile).not.toHaveBeenCalled();
      expect(unlink).not.toHaveBeenCalled();
    },
  );

  it("refuses a symlink planted at a read locator", async () => {
    await fs.mkdir(blobs, { recursive: true });
    const locator = "a".repeat(32);
    const outside = path.join(root, "outside");
    await fs.writeFile(outside, "not-a-secret");
    await fs.symlink(outside, path.join(blobs, locator));

    await expect(
      backend().withSecret(locator, async (value) => value),
    ).rejects.toThrow(/Refusing to follow symbolic link/);
    expect(await fs.readFile(outside, "utf8")).toBe("not-a-secret");
  });

  it("refuses a symlink planted at the generated write locator", async () => {
    await fs.mkdir(blobs, { recursive: true, mode: 0o700 });
    const locatorBytes = Buffer.alloc(16, 0xaa);
    const locator = locatorBytes.toString("hex");
    const outside = path.join(root, "outside");
    await fs.writeFile(outside, "untouched");
    await fs.symlink(outside, path.join(blobs, locator));
    const random = vi.fn((size: number) =>
      size === 12 ? Buffer.alloc(12, 0xbb) : locatorBytes,
    );
    const subject = new EncryptedFileSecretBackend(blobs, keyring(key(1)), {
      crypto: { randomBytes: random },
    });

    await expect(subject.store("secret")).rejects.toThrow(
      /Refusing to write through a symbolic link/,
    );
    expect(await fs.readFile(outside, "utf8")).toBe("untouched");
  });

  it("refuses to overwrite a regular file already at the generated write locator", async () => {
    // The randomness source has collided (or been subverted). Overwriting would
    // destroy a live secret with no way to recover it.
    await fs.mkdir(blobs, { recursive: true, mode: 0o700 });
    const locatorBytes = Buffer.alloc(16, 0xcc);
    const locator = locatorBytes.toString("hex");
    await fs.writeFile(path.join(blobs, locator), "existing-blob", {
      mode: 0o600,
    });
    const subject = new EncryptedFileSecretBackend(blobs, keyring(key(1)), {
      crypto: {
        randomBytes: vi.fn((size: number) =>
          size === 12 ? Buffer.alloc(12, 0xbb) : locatorBytes,
        ),
      },
    });

    await expect(subject.store("secret")).rejects.toThrow(
      /Refusing to overwrite existing blob/,
    );
    expect(await fs.readFile(path.join(blobs, locator), "utf8")).toBe(
      "existing-blob",
    );
  });

  it("deletes only the link, never the symlink target", async () => {
    await fs.mkdir(blobs, { recursive: true, mode: 0o700 });
    const locator = "d".repeat(32);
    const outside = path.join(root, "outside");
    await fs.writeFile(outside, "survives", { mode: 0o600 });
    await fs.symlink(outside, path.join(blobs, locator));

    await backend().delete(locator);
    expect(await fs.readFile(outside, "utf8")).toBe("survives");
    await expect(fs.lstat(path.join(blobs, locator))).rejects.toThrow(/ENOENT/);
  });

  it("keeps concurrent stores independent", async () => {
    // Single-writer process, but the server issues stores concurrently. Each
    // must land on its own locator with its own nonce.
    const subject = backend();
    const plaintexts = Array.from({ length: 12 }, (_, i) => `secret-${i}`);
    const locators = await Promise.all(
      plaintexts.map((value) => subject.store(value)),
    );
    expect(new Set(locators).size).toBe(plaintexts.length);
    expect(await fs.readdir(blobs)).toHaveLength(plaintexts.length);
    await Promise.all(
      locators.map(async (locator, i) =>
        expect(await subject.withSecret(locator, async (value) => value)).toBe(
          plaintexts[i],
        ),
      ),
    );
  });
});

describe("AC-5: authenticated envelope detects tampering", () => {
  it.each([
    ["ciphertext", HEADER.ciphertext],
    ["auth tag", HEADER.authTag],
    ["stored locator", HEADER.locator],
    ["format version", HEADER.version],
  ] as const)("rejects a flipped %s byte", async (_part, offset) => {
    const subject = backend();
    const locator = await subject.store("tamper-target");
    await rewriteBlob(locator, (blob) => {
      blob[offset] = (blob[offset]! ^ 1) & 0xff;
    });
    await expect(
      subject.withSecret(locator, async (value) => value),
    ).rejects.toThrow();
  });

  it("rejects a key-ID edit even when the replacement key is in the keyring", async () => {
    const active = key(1);
    const replacement = key(2);
    const subject = backend(keyring(active, [replacement]));
    const locator = await subject.store("tamper-target");
    await rewriteBlob(locator, (blob) => {
      blob.set(Buffer.from(deriveKeyId(replacement), "ascii"), HEADER.keyId);
    });
    await expect(
      subject.withSecret(locator, async (value) => value),
    ).rejects.toThrow();
  });

  it("rejects swapping an otherwise-valid blob onto another locator", async () => {
    const subject = backend();
    const first = await subject.store("first");
    const second = await subject.store("second");
    await fs.writeFile(path.join(blobs, second), await rawBlob(first), {
      mode: 0o600,
    });
    await expect(
      subject.withSecret(second, async (value) => value),
    ).rejects.toThrow();
  });
});

describe("AC-5b: malformed envelope decoding (no valid AEAD to fail through)", () => {
  const locator = "a".repeat(32);

  async function plantRawBlob(bytes: Buffer): Promise<void> {
    await fs.mkdir(blobs, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(blobs, locator), bytes, { mode: 0o600 });
  }

  it("rejects an empty file", async () => {
    await plantRawBlob(Buffer.alloc(0));
    await expect(
      backend().withSecret(locator, async (value) => value),
    ).rejects.toThrow(/Invalid encrypted blob envelope/);
  });

  it("rejects a file shorter than the fixed header", async () => {
    await plantRawBlob(Buffer.from("DFSB\x01"));
    await expect(
      backend().withSecret(locator, async (value) => value),
    ).rejects.toThrow(/Invalid encrypted blob envelope/);
  });

  it("rejects a file with the wrong magic bytes", async () => {
    const real = await backend().store("placeholder");
    const blob = await rawBlob(real);
    blob.write("XXXX", 0, "ascii");
    await plantRawBlob(blob);
    await expect(
      backend().withSecret(locator, async (value) => value),
    ).rejects.toThrow(/Invalid encrypted blob envelope/);
  });

  it("rejects a header claiming more metadata than the file contains", async () => {
    const real = await backend().store("placeholder");
    const blob = await rawBlob(real);
    // keyIdLength byte (offset 5): claim far more than actually follows.
    blob[HEADER.version + 1] = 0xff;
    await plantRawBlob(blob);
    await expect(
      backend().withSecret(locator, async (value) => value),
    ).rejects.toThrow(/Truncated encrypted blob envelope/);
  });

  it("rejects metadata that doesn't match the key-ID/locator grammar", async () => {
    const real = await backend().store("placeholder");
    const blob = await rawBlob(real);
    // First byte of the embedded key ID: push it outside [a-f0-9].
    blob[HEADER.keyId] = "Z".charCodeAt(0);
    await plantRawBlob(blob);
    await expect(
      backend().withSecret(locator, async (value) => value),
    ).rejects.toThrow(/Invalid encrypted blob metadata/);
  });
});

describe("AC-6: key validation at startup", () => {
  it("rejects a constructor key with the wrong length", () => {
    const short = Buffer.alloc(31, 1);
    expect(
      () =>
        new EncryptedFileSecretBackend(blobs, {
          activeKeyId: deriveKeyId(short),
          keys: new Map([[deriveKeyId(short), short]]),
        }),
    ).toThrow(/exactly 32 bytes/);
  });

  it("rejects bad base64 and valid base64 of the wrong length", async () => {
    await expect(
      loadSecretKeyring({ DASHFRAME_SECRET_KEY: "not-base64" }),
    ).rejects.toThrow(/canonical padded base64/);
    await expect(
      loadSecretKeyring({
        DASHFRAME_SECRET_KEY: Buffer.alloc(31).toString("base64"),
      }),
    ).rejects.toThrow(/canonical padded base64|exactly 32 bytes/);
    await expect(
      loadSecretKeyring({ DASHFRAME_SECRET_KEY: "" }),
    ).rejects.toThrow(/canonical padded base64/);
  });

  it("rejects an explicitly empty key-file path", async () => {
    await expect(
      loadSecretKeyring({ DASHFRAME_SECRET_KEY_FILE: "" }),
    ).rejects.toThrow(/must not be empty/);
  });

  it("rejects a missing key file", async () => {
    await expect(
      loadSecretKeyring({
        DASHFRAME_SECRET_KEY_FILE: path.join(root, "missing"),
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects a symlinked key file", async () => {
    const target = path.join(root, "real-key");
    const link = path.join(root, "key-link");
    await fs.writeFile(target, key(1).toString("base64"), { mode: 0o600 });
    await fs.symlink(target, link);
    await expect(
      loadSecretKeyring({ DASHFRAME_SECRET_KEY_FILE: link }),
    ).rejects.toThrow(/must not be a symbolic link/);
  });

  it("rejects group/world-readable key-file permissions", async () => {
    const file = path.join(root, "wide-key");
    await fs.writeFile(file, key(1).toString("base64"), { mode: 0o600 });
    // eslint-disable-next-line sonarjs/file-permissions -- deliberately insecure mode under test
    await fs.chmod(file, 0o644);
    await expect(
      loadSecretKeyring({ DASHFRAME_SECRET_KEY_FILE: file }),
    ).rejects.toThrow(/must not be group- or world-accessible/);
  });

  it("loads a mode-0600 key file with one trailing newline", async () => {
    const file = path.join(root, "key");
    await fs.writeFile(file, `${key(1).toString("base64")}\n`, { mode: 0o600 });
    await fs.chmod(file, 0o600);
    const loaded = await loadSecretKeyring({ DASHFRAME_SECRET_KEY_FILE: file });
    expect(loaded?.activeKeyId).toBe(deriveKeyId(key(1)));
    expect(loaded?.keys.get(deriveKeyId(key(1)))?.equals(key(1))).toBe(true);
  });

  it("rejects ambiguous file-plus-inline configuration", async () => {
    await expect(
      loadSecretKeyring({
        DASHFRAME_SECRET_KEY_FILE: "/unused",
        DASHFRAME_SECRET_KEY: key(1).toString("base64"),
      }),
    ).rejects.toThrow(/Set only one/);
  });

  it("loads retired keys from DASHFRAME_SECRET_KEY_PREVIOUS alongside the active key", async () => {
    const loaded = await loadSecretKeyring({
      DASHFRAME_SECRET_KEY: key(2).toString("base64"),
      DASHFRAME_SECRET_KEY_PREVIOUS: `${key(1).toString("base64")},${key(3).toString("base64")}`,
    });
    expect(loaded?.activeKeyId).toBe(deriveKeyId(key(2)));
    expect(loaded?.keys.size).toBe(3);
    expect(loaded?.keys.get(deriveKeyId(key(1)))?.equals(key(1))).toBe(true);
    expect(loaded?.keys.get(deriveKeyId(key(3)))?.equals(key(3))).toBe(true);
  });

  it("rejects a malformed entry in DASHFRAME_SECRET_KEY_PREVIOUS", async () => {
    await expect(
      loadSecretKeyring({
        DASHFRAME_SECRET_KEY: key(1).toString("base64"),
        DASHFRAME_SECRET_KEY_PREVIOUS: "not-base64",
      }),
    ).rejects.toThrow(/canonical padded base64/);
  });

  it("rejects an empty entry in a comma-separated DASHFRAME_SECRET_KEY_PREVIOUS list", async () => {
    await expect(
      loadSecretKeyring({
        DASHFRAME_SECRET_KEY: key(1).toString("base64"),
        DASHFRAME_SECRET_KEY_PREVIOUS: `${key(2).toString("base64")},`,
      }),
    ).rejects.toThrow(/entry 2 is empty/);
  });
});

describe("AC-7: keyring rotation", () => {
  it("reads an old-key blob while writing every new blob with the active key", async () => {
    const oldKey = key(1);
    const newKey = key(2);
    const oldBackend = backend(keyring(oldKey));
    const oldLocator = await oldBackend.store("old-secret");

    const rotating = backend(keyring(newKey, [oldKey]));
    await expect(
      rotating.withSecret(oldLocator, async (value) => value),
    ).resolves.toBe("old-secret");

    const newLocator = await rotating.store("new-secret");
    expect(
      (await rawBlob(newLocator)).includes(Buffer.from(deriveKeyId(newKey))),
    ).toBe(true);
    expect(
      (await rawBlob(newLocator)).includes(Buffer.from(deriveKeyId(oldKey))),
    ).toBe(false);
  });

  it("fails closed when a blob key ID is absent from the keyring", async () => {
    const oldBackend = backend(keyring(key(1)));
    const locator = await oldBackend.store("old-secret");
    const newOnly = backend(keyring(key(2)));
    await expect(
      newOnly.withSecret(locator, async (value) => value),
    ).rejects.toThrow(/not present in the configured keyring/);
  });

  it("survives a full rotation and then fails closed when the old key is dropped", async () => {
    // The operator-facing rotation sequence, end to end through the env-var
    // loader: issue under A → rotate to B keeping A in PREVIOUS → the old blob
    // still reads → drop A → it fails closed rather than returning garbage.
    const oldKey = key(1);
    const newKey = key(2);

    const before = await loadSecretKeyring({
      DASHFRAME_SECRET_KEY: oldKey.toString("base64"),
    });
    const locator = await new EncryptedFileSecretBackend(blobs, before!).store(
      "issued-before-rotation",
    );

    const during = await loadSecretKeyring({
      DASHFRAME_SECRET_KEY: newKey.toString("base64"),
      DASHFRAME_SECRET_KEY_PREVIOUS: oldKey.toString("base64"),
    });
    const rotating = new EncryptedFileSecretBackend(blobs, during!);
    expect(await rotating.withSecret(locator, async (value) => value)).toBe(
      "issued-before-rotation",
    );
    // New writes always use the active key, never a retired one.
    const rewritten = await rotating.store("issued-after-rotation");
    expect((await rawBlob(rewritten)).subarray(35, 51).toString("ascii")).toBe(
      deriveKeyId(newKey),
    );

    const after = await loadSecretKeyring({
      DASHFRAME_SECRET_KEY: newKey.toString("base64"),
    });
    const dropped = new EncryptedFileSecretBackend(blobs, after!);
    await expect(
      dropped.withSecret(locator, async (value) => value),
    ).rejects.toThrow(/not present in the configured keyring/);
    expect(await dropped.withSecret(rewritten, async (value) => value)).toBe(
      "issued-after-rotation",
    );
  });

  it("refuses to start with retired keys but no active key", async () => {
    // A rotation that moved the key out of DASHFRAME_SECRET_KEY without setting
    // the new one would otherwise silently start with no encrypted backend.
    await expect(
      loadSecretKeyring({
        DASHFRAME_SECRET_KEY_PREVIOUS: key(1).toString("base64"),
      }),
    ).rejects.toThrow(/no active key is configured/);
  });

  it("tolerates one trailing newline on an inline key, same as a key file", async () => {
    const loaded = await loadSecretKeyring({
      DASHFRAME_SECRET_KEY: `${key(1).toString("base64")}\n`,
    });
    expect(loaded?.activeKeyId).toBe(deriveKeyId(key(1)));
  });
});

describe("AC-8: durable atomic writes", () => {
  it("cleans the same-directory temp file after a simulated rename failure", async () => {
    const subject = new EncryptedFileSecretBackend(blobs, keyring(key(1)), {
      fs: {
        rename: vi.fn(async () => {
          throw new Error("simulated rename failure");
        }),
      },
    });
    await expect(subject.store("secret")).rejects.toThrow(
      "simulated rename failure",
    );
    expect(await fs.readdir(blobs)).toEqual([]);
  });

  it("leaves no temp file behind after a successful store", async () => {
    const subject = backend();
    await subject.store("secret");
    const entries = await fs.readdir(blobs);
    expect(entries).toHaveLength(1);
    expect(entries.every((entry) => !entry.endsWith(".tmp"))).toBe(true);
  });

  it("keeps a stored secret when the post-rename directory fsync fails", async () => {
    // Some filesystems refuse to open a directory for fsync. That happens
    // AFTER the blob is durably renamed into place, so it must not fail the
    // store — and above all must not trigger the rollback that unlinks the
    // blob. Regression guard against losing an already-persisted secret.
    const realOpen = fs.open.bind(fs);
    const subject = new EncryptedFileSecretBackend(blobs, keyring(key(1)), {
      fs: {
        open: (async (
          target: string,
          flags: string | number,
          mode?: number,
        ) => {
          if (target === blobs)
            throw new Error("EISDIR: cannot fsync directory");
          return realOpen(target, flags as never, mode);
        }) as never,
      },
    });

    const locator = await subject.store("survives-the-fsync-quirk");
    expect(await subject.has(locator)).toBe(true);
    expect(
      await subject.withSecret(locator, async (plaintext) => plaintext),
    ).toBe("survives-the-fsync-quirk");
  });
});

/**
 * These errors surface through the access-credentials RPC handlers to a remote
 * caller. A locator is a live handle to a stored secret, and the host
 * filesystem layout is not the caller's to learn — so neither may appear in the
 * message. The detail is expected to live in `cause` instead.
 */
function expectsNoPathOrLocator(locator?: string): unknown {
  return expect.objectContaining({
    message: expect.not.stringMatching(
      new RegExp(
        [
          escapeRegExp(root),
          escapeRegExp(os.tmpdir()),
          "[/\\\\]",
          ...(locator ? [escapeRegExp(locator)] : []),
        ].join("|"),
      ),
    ),
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("AC-9: error-message hygiene", () => {
  it("never echoes the locator back in a lookup or validation failure", async () => {
    const subject = backend();
    const absent = "a".repeat(32);

    // A locator is a live handle to a stored secret; these errors reach a
    // remote caller through the access-credentials RPC handlers.
    await expect(
      subject.withSecret(absent, async (plaintext) => plaintext),
    ).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(absent) }),
    );
    await expect(subject.has("../../etc/passwd")).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("etc/passwd"),
      }),
    );
  });

  it("never names the key ID when a blob's key is absent from the keyring", async () => {
    const retired = key(9);
    const written = new EncryptedFileSecretBackend(blobs, keyring(retired));
    const locator = await written.store("orphaned");

    const rotated = backend(keyring(key(1)));
    await expect(
      rotated.withSecret(locator, async (plaintext) => plaintext),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(deriveKeyId(retired)),
      }),
    );
  });

  it("never leaks a host path or locator on the symlink read path", async () => {
    await fs.mkdir(blobs, { recursive: true, mode: 0o700 });
    const locator = "a".repeat(32);
    const outside = path.join(root, "outside");
    await fs.writeFile(outside, "not-a-secret", { mode: 0o600 });
    await fs.symlink(outside, path.join(blobs, locator));

    await expect(
      backend().withSecret(locator, async (value) => value),
    ).rejects.toThrow(expectsNoPathOrLocator(locator));
  });

  it("never leaks a host path or locator when refusing to overwrite a blob", async () => {
    await fs.mkdir(blobs, { recursive: true, mode: 0o700 });
    const locatorBytes = Buffer.alloc(16, 0xcc);
    const locator = locatorBytes.toString("hex");
    await fs.writeFile(path.join(blobs, locator), "existing-blob", {
      mode: 0o600,
    });
    const subject = new EncryptedFileSecretBackend(blobs, keyring(key(1)), {
      crypto: {
        randomBytes: vi.fn((size: number) =>
          size === 12 ? Buffer.alloc(12, 0xbb) : locatorBytes,
        ),
      },
    });

    await expect(subject.store("secret")).rejects.toThrow(
      expectsNoPathOrLocator(locator),
    );
  });

  it("never leaks the storage path when the directory is mis-permissioned", async () => {
    await fs.mkdir(blobs, { recursive: true, mode: 0o700 });
    // eslint-disable-next-line sonarjs/file-permissions -- deliberately insecure mode under test
    await fs.chmod(blobs, 0o755);
    await expect(backend().store("secret")).rejects.toThrow(
      expectsNoPathOrLocator(),
    );
  });

  it("never leaks the storage path when the directory is a symlink", async () => {
    const real = path.join(root, "elsewhere");
    await fs.mkdir(real, { mode: 0o700 });
    await fs.symlink(real, blobs);
    await expect(backend().store("secret")).rejects.toThrow(
      expectsNoPathOrLocator(),
    );
  });
});
