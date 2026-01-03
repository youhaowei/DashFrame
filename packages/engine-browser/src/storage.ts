import type { DataFrameStorage, UUID } from "@dashframe/engine";
import { del, get, keys, set } from "idb-keyval";

/**
 * IndexedDB implementation of DataFrameStorage.
 *
 * Uses idb-keyval for simple key-value storage of Arrow IPC buffers.
 * Each DataFrame is stored with a prefixed key for namespace isolation.
 */
export class IndexedDBStorage implements DataFrameStorage {
  private readonly prefix = "dashframe:arrow:";

  /**
   * Generate storage key from DataFrame ID.
   */
  private getKey(id: UUID): string {
    return `${this.prefix}${id}`;
  }

  /**
   * Extract DataFrame ID from storage key.
   */
  extractId(key: string): UUID | null {
    if (key.startsWith(this.prefix)) {
      return key.slice(this.prefix.length);
    }
    return null;
  }

  async save(id: UUID, data: Uint8Array): Promise<void> {
    await set(this.getKey(id), data);
  }

  async load(id: UUID): Promise<Uint8Array | null> {
    const buffer = await get<Uint8Array>(this.getKey(id));
    return buffer ?? null;
  }

  async delete(id: UUID): Promise<void> {
    await del(this.getKey(id));
  }

  async exists(id: UUID): Promise<boolean> {
    const buffer = await get(this.getKey(id));
    return buffer !== undefined;
  }

  async list(): Promise<UUID[]> {
    const allKeys = await keys();
    return allKeys
      .filter(
        (key): key is string =>
          typeof key === "string" && key.startsWith(this.prefix),
      )
      .map((key) => key.slice(this.prefix.length));
  }

  async getUsage(): Promise<{ count: number; totalBytes?: number }> {
    const ids = await this.list();
    let totalBytes = 0;

    for (const id of ids) {
      const buffer = await this.load(id);
      if (buffer) {
        totalBytes += buffer.byteLength;
      }
    }

    return { count: ids.length, totalBytes };
  }
}

// Singleton instance for convenience
export const indexedDBStorage = new IndexedDBStorage();

// Legacy exports for backward compatibility
export const persistArrowData = (key: string, data: Uint8Array) =>
  set(key, data);
export const loadArrowData = async (
  key: string,
): Promise<Uint8Array | null> => {
  const buffer = await get<Uint8Array>(key);
  return buffer ?? null;
};
export const deleteArrowData = (key: string) => del(key);
export const generateArrowKey = (dataFrameId: string) =>
  `dashframe:arrow:${dataFrameId}`;
export const extractDataFrameId = (arrowKey: string): string | null => {
  const match = arrowKey.match(/^dashframe:arrow:(.+)$/);
  return match ? match[1] : null;
};
