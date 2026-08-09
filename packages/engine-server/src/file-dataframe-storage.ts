import type { DataFrameStorage } from "@dashframe/engine";
import type { UUID } from "@dashframe/types";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const FRAME_EXTENSION = ".arrow";
const TRASH_DIRECTORY = ".trash";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectoryIfExists(
  directory: string,
  sync: (directory: string) => Promise<void>,
): Promise<void> {
  try {
    await sync(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function ensureDirectory(
  directory: string,
  sync: (directory: string) => Promise<void>,
): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await sync(path.dirname(directory));
  await sync(directory);
}

/** Durable Arrow IPC storage rooted inside one DashFrame project. */
export class FileDataFrameStorage implements DataFrameStorage {
  constructor(
    readonly directory: string,
    private readonly sync = syncDirectory,
  ) {}

  private framePath(id: UUID): string {
    if (!UUID_PATTERN.test(id)) {
      throw new Error(`Invalid DataFrame id: ${id}`);
    }
    return path.join(this.directory, `${id}${FRAME_EXTENSION}`);
  }

  async save(id: UUID, data: Uint8Array): Promise<void> {
    const target = this.framePath(id);
    await ensureDirectory(this.directory, this.sync);
    const temporary = path.join(
      this.directory,
      `.${id}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, target);
      // The file sync makes its bytes durable; the directory sync makes the
      // atomic rename durable before metadata is allowed to reference it.
      await this.sync(this.directory);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async load(id: UUID): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(this.framePath(id)));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  async delete(id: UUID): Promise<void> {
    await fs.rm(this.framePath(id), { force: true });
    await syncDirectoryIfExists(this.directory, this.sync);
  }

  async stageDelete(id: UUID): Promise<string | null> {
    const target = this.framePath(id);
    const token = `${id}.${randomUUID()}`;
    const trashDirectory = path.join(this.directory, TRASH_DIRECTORY);
    await ensureDirectory(trashDirectory, this.sync);
    try {
      // Preserve the active name while metadata still references it. The hard
      // link is the recovery copy; final deletion happens only after commit.
      await fs.link(target, path.join(trashDirectory, token));
      await this.sync(trashDirectory);
      return token;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  async commitDelete(token: string): Promise<void> {
    const [id] = token.split(".");
    if (!id || !UUID_PATTERN.test(id)) throw new Error("Invalid delete token");
    await fs.rm(this.framePath(id as UUID), { force: true });
    await syncDirectoryIfExists(this.directory, this.sync);
    await fs.rm(this.trashPath(token), { force: true });
    await syncDirectoryIfExists(
      path.join(this.directory, TRASH_DIRECTORY),
      this.sync,
    );
  }

  async rollbackDelete(token: string): Promise<void> {
    await fs.rm(this.trashPath(token), { force: true });
    await syncDirectoryIfExists(
      path.join(this.directory, TRASH_DIRECTORY),
      this.sync,
    );
  }

  async recoverStagedDeletes(referencedIds: readonly UUID[]): Promise<void> {
    const referenced = new Set(referencedIds);
    const trashDirectory = path.join(this.directory, TRASH_DIRECTORY);
    let tokens: string[];
    try {
      tokens = await fs.readdir(trashDirectory);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
    for (const token of tokens) {
      const [id] = token.split(".");
      if (!id || !UUID_PATTERN.test(id)) continue;
      if (referenced.has(id as UUID)) {
        await this.recoverReferencedToken(id as UUID, token);
      } else {
        await this.commitDelete(token);
      }
    }
  }

  private async recoverReferencedToken(id: UUID, token: string): Promise<void> {
    try {
      await this.rollbackDelete(token);
    } catch (error) {
      // A later save owns the active path. Keep the staged bytes intact for
      // explicit recovery instead of replacing the newer committed frame.
      if (
        error instanceof Error &&
        error.message.includes("an active frame already exists")
      ) {
        console.error(
          `[dashframe] staged frame ${id} collides with an active frame; leaving staged bytes for recovery`,
          error,
        );
        return;
      }
      throw error;
    }
  }

  private trashPath(token: string): string {
    if (!/^[0-9a-f-]{36}\.[0-9a-f-]{36}$/i.test(token)) {
      throw new Error("Invalid delete token");
    }
    return path.join(this.directory, TRASH_DIRECTORY, token);
  }

  async exists(id: UUID): Promise<boolean> {
    try {
      await fs.access(this.framePath(id));
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }

  async list(): Promise<UUID[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.directory);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
    return entries
      .filter((entry) => entry.endsWith(FRAME_EXTENSION))
      .map((entry) => entry.slice(0, -FRAME_EXTENSION.length))
      .filter((id): id is UUID => UUID_PATTERN.test(id));
  }

  async getUsage(): Promise<{ count: number; totalBytes: number }> {
    const ids = await this.list();
    const sizes = await Promise.all(
      ids.map(async (id) => (await fs.stat(this.framePath(id))).size),
    );
    return {
      count: ids.length,
      totalBytes: sizes.reduce((total, size) => total + size, 0),
    };
  }
}
