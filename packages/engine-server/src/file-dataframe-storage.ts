import type { DataFrameStorage } from "@dashframe/engine";
import type { UUID } from "@dashframe/types";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const FRAME_EXTENSION = ".arrow";
const TRASH_DIRECTORY = ".trash";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Durable Arrow IPC storage rooted inside one DashFrame project. */
export class FileDataFrameStorage implements DataFrameStorage {
  constructor(readonly directory: string) {}

  private framePath(id: UUID): string {
    if (!UUID_PATTERN.test(id)) {
      throw new Error(`Invalid DataFrame id: ${id}`);
    }
    return path.join(this.directory, `${id}${FRAME_EXTENSION}`);
  }

  async save(id: UUID, data: Uint8Array): Promise<void> {
    const target = this.framePath(id);
    await fs.mkdir(this.directory, { recursive: true });
    const temporary = path.join(
      this.directory,
      `.${id}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await fs.writeFile(temporary, data, { mode: 0o600 });
      await fs.rename(temporary, target);
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
  }

  async stageDelete(id: UUID): Promise<string | null> {
    const target = this.framePath(id);
    const token = `${id}.${randomUUID()}`;
    const trashDirectory = path.join(this.directory, TRASH_DIRECTORY);
    await fs.mkdir(trashDirectory, { recursive: true });
    try {
      await fs.rename(target, path.join(trashDirectory, token));
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
    await fs.rm(this.trashPath(token), { force: true });
  }

  async rollbackDelete(token: string): Promise<void> {
    const [id] = token.split(".");
    if (!id || !UUID_PATTERN.test(id)) throw new Error("Invalid delete token");
    try {
      await fs.rename(this.trashPath(token), this.framePath(id as UUID));
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
        await this.rollbackDelete(token);
      } else {
        await this.commitDelete(token);
      }
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
