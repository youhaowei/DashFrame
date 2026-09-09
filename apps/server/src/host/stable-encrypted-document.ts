import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  decryptStableDocument,
  encryptStableDocument,
  type SecretKeyringConfig,
} from "../secret-file-backend";

export interface StableDocumentCodec<T> {
  empty(): T;
  parse(value: unknown): T;
}

export interface StableDocumentDependencies {
  /** Test seam for an uncertain error after rename has committed. */
  afterRename?(): Promise<void>;
}

/**
 * One instance requires exclusive process ownership of its workspace volume.
 * The hosted runtime factory must acquire that ownership before construction.
 */
export class StableEncryptedDocument<T> {
  readonly #file: string;
  readonly #aad: Buffer;
  #queue: Promise<void> = Promise.resolve();
  #value: T | undefined;

  constructor(
    directory: string,
    workspaceId: string,
    private readonly keyring: SecretKeyringConfig,
    private readonly codec: StableDocumentCodec<T>,
    private readonly dependencies: StableDocumentDependencies = {},
  ) {
    if (
      !workspaceId ||
      workspaceId.trim() !== workspaceId ||
      /[\s\p{Cc}]/u.test(workspaceId)
    )
      throw new Error("Invalid workspace identity");
    this.#file = path.join(directory, "connector-sessions.dfsd");
    this.#aad = Buffer.concat([
      Buffer.from("dashframe-stable-document\0v1\0connector-sessions\0"),
      createHash("sha256").update(workspaceId).digest(),
      Buffer.from("\0connector-sessions.dfsd"),
    ]);
  }

  read<R>(operation: (value: T) => R | Promise<R>): Promise<R> {
    return this.#exclusive(async () => operation(await this.#load()));
  }

  update<R>(
    operation: (value: T) => { value: T; result: R; changed?: boolean },
  ): Promise<R> {
    return this.#exclusive(async () => {
      const current = await this.#load();
      const updated = operation(current);
      if (updated.changed === false) return updated.result;
      try {
        await this.#write(updated.value);
        this.#value = updated.value;
        return updated.result;
      } catch (error) {
        // Rename may already have committed. Forget memory and reload the only
        // durable truth before another transition is allowed through the queue.
        this.#value = undefined;
        await this.#load();
        throw error;
      }
    });
  }

  async #load(): Promise<T> {
    if (this.#value !== undefined) return this.#value;
    await this.#ensureDirectory();
    let handle;
    try {
      handle = await fs.open(
        this.#file,
        typeof constants.O_NOFOLLOW === "number"
          ? constants.O_RDONLY | constants.O_NOFOLLOW
          : "r",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.#value = this.codec.empty();
        return this.#value;
      }
      throw new Error("Encrypted connector session document is unavailable", {
        cause: error,
      });
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || (stat.mode & 0o077) !== 0)
        throw new Error("Encrypted connector session document is unsafe");
      const plaintext = decryptStableDocument(
        await handle.readFile(),
        this.#aad,
        this.keyring,
      );
      this.#value = this.codec.parse(JSON.parse(plaintext));
      return this.#value;
    } finally {
      await handle.close();
    }
  }

  async #write(value: T): Promise<void> {
    // Recheck on every write even when the decrypted value is cached: an
    // operator or local attacker may have relaxed/replaced the directory.
    await this.#ensureDirectory();
    const parsed = this.codec.parse(value);
    const blob = encryptStableDocument(
      JSON.stringify(parsed),
      this.#aad,
      this.keyring,
    );
    const directory = path.dirname(this.#file);
    const temporary = path.join(
      directory,
      `.connector-sessions.${randomUUID()}.tmp`,
    );
    let handle;
    try {
      handle = await fs.open(temporary, "wx", 0o600);
      await handle.writeFile(blob);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.#assertSafeTarget();
      await fs.rename(temporary, this.#file);
      await this.dependencies.afterRename?.();
      if (process.platform !== "win32") {
        const parent = await fs.open(directory, "r");
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      }
    } finally {
      await handle?.close().catch(() => undefined);
      await fs.rm(temporary, { force: true });
    }
  }

  async #ensureDirectory(): Promise<void> {
    const directory = path.dirname(this.#file);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error("Connector session directory is unsafe");
  }

  async #assertSafeTarget(): Promise<void> {
    try {
      const stat = await fs.lstat(this.#file);
      if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0)
        throw new Error("Connector session document target is unsafe");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  #exclusive<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
