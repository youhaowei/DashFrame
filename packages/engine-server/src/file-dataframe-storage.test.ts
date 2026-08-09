import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileDataFrameStorage } from "./file-dataframe-storage";

describe("FileDataFrameStorage", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("survives recreation against the same project directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const directory = path.join(root, "frames");
    const id = "11111111-1111-4111-8111-111111111111";
    const bytes = new Uint8Array([1, 2, 3, 4]);

    await new FileDataFrameStorage(directory).save(id, bytes);
    const restarted = new FileDataFrameStorage(directory);

    expect(await restarted.load(id)).toEqual(bytes);
    expect(await restarted.exists(id)).toBe(true);
    expect(await restarted.list()).toEqual([id]);
    expect(await restarted.getUsage()).toEqual({ count: 1, totalBytes: 4 });
  });

  it("rejects ids that could escape the storage directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));

    await expect(storage.save("../escape", new Uint8Array())).rejects.toThrow(
      "Invalid DataFrame id",
    );
  });

  it("rolls back and commits staged deletes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const id = "11111111-1111-4111-8111-111111111111";
    await storage.save(id, new Uint8Array([7]));

    const rollbackToken = await storage.stageDelete(id);
    expect(await storage.exists(id)).toBe(true);
    await storage.rollbackDelete(rollbackToken!);
    expect(await storage.load(id)).toEqual(new Uint8Array([7]));

    const commitToken = await storage.stageDelete(id);
    await storage.commitDelete(commitToken!);
    expect(await storage.exists(id)).toBe(false);
  });

  it("syncs delete lifecycle directory entries before advancing metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const directory = path.join(root, "frames");
    const trash = path.join(directory, ".trash");
    const synced: string[] = [];
    const storage = new FileDataFrameStorage(directory, async (entry) => {
      synced.push(entry);
    });
    const id = "11111111-1111-4111-8111-111111111111";
    await storage.save(id, new Uint8Array([7]));
    synced.length = 0;

    const rollbackToken = await storage.stageDelete(id);
    expect(synced).toEqual([directory, trash, trash]);
    synced.length = 0;
    await storage.rollbackDelete(rollbackToken!);
    expect(synced).toEqual([trash]);

    const commitToken = await storage.stageDelete(id);
    synced.length = 0;
    await storage.commitDelete(commitToken!);
    expect(synced).toEqual([directory, trash]);
  });

  it("keeps the active frame readable while a staged delete rolls back", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const id = "11111111-1111-4111-8111-111111111111";
    await storage.save(id, new Uint8Array([1]));

    const token = await storage.stageDelete(id);
    expect(token).not.toBeNull();
    expect(await storage.load(id)).toEqual(new Uint8Array([1]));
    await storage.rollbackDelete(token!);
    expect(await storage.load(id)).toEqual(new Uint8Array([1]));
  });

  it("recovers interrupted staged deletes from committed ownership", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const referenced = "11111111-1111-4111-8111-111111111111";
    const removed = "22222222-2222-4222-8222-222222222222";
    await storage.save(referenced, new Uint8Array([1]));
    await storage.save(removed, new Uint8Array([2]));
    await storage.stageDelete(referenced);
    await storage.stageDelete(removed);

    await storage.recoverStagedDeletes([referenced]);

    expect(await storage.load(referenced)).toEqual(new Uint8Array([1]));
    expect(await storage.exists(removed)).toBe(false);
  });
});
