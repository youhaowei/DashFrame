import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  Float64,
  Field,
  RecordBatch,
  Schema,
  Table,
  tableFromIPC,
  tableToIPC,
  Utf8,
  vectorFromArray,
} from "apache-arrow";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { FileDataFrameStorage } from "./file-dataframe-storage";

describe("FileDataFrameStorage", () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("persists standalone batches as one restart-compatible IPC stream", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const directory = path.join(root, "frames");
    const id = "11111111-1111-4111-8111-111111111111";
    let pulls = 0;
    const batches = (async function* () {
      for (let start = 0; start < 25_001; start += 2048) {
        pulls += 1;
        const values = Array.from(
          { length: Math.min(2048, 25_001 - start) },
          (_, index) => start + index,
        );
        yield tableToIPC(
          new Table({ value: vectorFromArray(values, new Float64()) }),
        );
      }
    })();

    await new FileDataFrameStorage(directory).saveBatches(id, batches);
    expect(pulls).toBe(13);

    const restarted = new FileDataFrameStorage(directory);
    const table = await tableFromIPC(restarted.stream(id));
    expect(table.numRows).toBe(25_001);
    expect(table.getChild("value")?.get(25_000)).toBe(25_000);
  });

  it("keeps the previous generation when incremental persistence fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const directory = path.join(root, "frames");
    const storage = new FileDataFrameStorage(directory);
    const id = "11111111-1111-4111-8111-111111111111";
    const original = tableToIPC(
      new Table({ value: vectorFromArray([7], new Float64()) }),
    );
    await storage.save(id, original);

    const failing = (async function* () {
      yield tableToIPC(
        new Table({ value: vectorFromArray([1, 2], new Float64()) }),
      );
      throw new Error("provider failed");
    })();
    await expect(storage.saveBatches(id, failing)).rejects.toThrow(
      "provider failed",
    );
    expect(await storage.load(id)).toEqual(original);
    expect(
      (await readdir(directory)).filter((entry) => entry.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("rejects schema drift without replacing the previous generation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const id = "11111111-1111-4111-8111-111111111111";
    const original = tableToIPC(
      new Table({ value: vectorFromArray([7], new Float64()) }),
    );
    await storage.save(id, original);
    const drifting = (async function* () {
      yield tableToIPC(
        new Table({ value: vectorFromArray([1], new Float64()) }),
      );
      yield tableToIPC(
        new Table({ value: vectorFromArray(["wrong"], new Utf8()) }),
      );
    })();

    await expect(storage.saveBatches(id, drifting)).rejects.toThrow(
      "schema does not match",
    );
    expect(await storage.load(id)).toEqual(original);
  });

  it("rejects metadata drift before emitting a second IPC stream", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const id = "11111111-1111-4111-8111-111111111111";
    const first = new Table({
      value: vectorFromArray([1], new Float64()),
    });
    const changedSchema = new Schema(
      [
        new Field(
          "value",
          new Float64(),
          true,
          new Map([["field-id", "changed"]]),
        ),
      ],
      new Map([["generation", "changed"]]),
    );
    const changedBatch = new RecordBatch(changedSchema, first.batches[0]!.data);
    const drifting = (async function* () {
      yield tableToIPC(first);
      yield tableToIPC(new Table(changedSchema, [changedBatch]));
    })();

    await expect(storage.saveBatches(id, drifting)).rejects.toThrow(
      "schema does not match",
    );
    expect(await storage.exists(id)).toBe(false);
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

  it("preserves a replacement save when committing a staged generation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const id = "11111111-1111-4111-8111-111111111111";
    await storage.save(id, new Uint8Array([1]));
    const token = await storage.stageDelete(id);

    await storage.save(id, new Uint8Array([2]));
    await storage.commitDelete(token!);

    expect(await storage.load(id)).toEqual(new Uint8Array([2]));
    expect(await storage.hasPendingDataFrameDeletes()).toBe(false);
  });

  it("reports a rollback collision and retains its recovery token", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const id = "11111111-1111-4111-8111-111111111111";
    await storage.save(id, new Uint8Array([1]));
    const token = await storage.stageDelete(id);

    await storage.save(id, new Uint8Array([2]));
    await expect(storage.rollbackDelete(token!)).rejects.toThrow(
      "contains a newer generation",
    );

    expect(await storage.load(id)).toEqual(new Uint8Array([2]));
    expect(await storage.hasPendingDataFrameDeletes()).toBe(true);
  });

  it("resolves a replacement collision on restart without overwriting newer bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const directory = path.join(root, "frames");
    const id = "11111111-1111-4111-8111-111111111111";
    const storage = new FileDataFrameStorage(directory);
    await storage.save(id, new Uint8Array([1]));
    await storage.stageDelete(id);
    await storage.save(id, new Uint8Array([2]));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await new FileDataFrameStorage(directory).recoverStagedDeletes([id]);

    expect(await storage.load(id)).toEqual(new Uint8Array([2]));
    expect(await storage.hasPendingDataFrameDeletes()).toBe(false);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("discarding the older staged generation"),
    );
  });

  it("restores referenced bytes when the active link was unlinked", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const directory = path.join(root, "frames");
    const trash = path.join(directory, ".trash");
    const synced: string[] = [];
    const storage = new FileDataFrameStorage(directory, async (entry) => {
      synced.push(entry);
    });
    const id = "11111111-1111-4111-8111-111111111111";
    await storage.save(id, new Uint8Array([9, 8]));
    await storage.stageDelete(id);
    await rm(path.join(directory, `${id}.arrow`));
    synced.length = 0;

    await storage.recoverStagedDeletes([id]);

    expect(await storage.load(id)).toEqual(new Uint8Array([9, 8]));
    expect(await storage.hasPendingDataFrameDeletes()).toBe(false);
    expect(synced).toEqual([directory, trash]);
  });

  it("finalizes an unreferenced staged generation without deleting a replacement", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const id = "11111111-1111-4111-8111-111111111111";
    await storage.save(id, new Uint8Array([1]));
    await storage.stageDelete(id);
    await storage.save(id, new Uint8Array([3]));

    await storage.recoverStagedDeletes([]);

    expect(await storage.load(id)).toEqual(new Uint8Array([3]));
    expect(await storage.hasPendingDataFrameDeletes()).toBe(false);
  });

  it("validates the complete delete token before touching active bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const id = "11111111-1111-4111-8111-111111111111";
    await storage.save(id, new Uint8Array([7]));

    await expect(storage.commitDelete(`${id}.malformed`)).rejects.toThrow(
      "Invalid delete token",
    );

    expect(await storage.load(id)).toEqual(new Uint8Array([7]));
  });

  it("reports whether valid staged DataFrame deletes are pending", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const directory = path.join(root, "frames");
    const storage = new FileDataFrameStorage(directory);
    const id = "11111111-1111-4111-8111-111111111111";
    expect(await storage.hasPendingDataFrameDeletes()).toBe(false);
    await storage.save(id, new Uint8Array([1]));
    const token = await storage.stageDelete(id);

    expect(await storage.hasPendingDataFrameDeletes()).toBe(true);

    await storage.rollbackDelete(token!);
    expect(await storage.hasPendingDataFrameDeletes()).toBe(false);
  });

  it("removes only save temp files matching the exact startup recovery format", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const directory = path.join(root, "frames");
    const storage = new FileDataFrameStorage(directory);
    const id = "11111111-1111-4111-8111-111111111111";
    const nonce = "22222222-2222-4222-8222-222222222222";
    await storage.save(id, new Uint8Array([1]));
    const stale = `.${id}.1234.${nonce}.tmp`;
    const unrelated = [
      ".notes",
      `.${id}.not-a-pid.${nonce}.tmp`,
      `.${id}.1234.not-a-uuid.tmp`,
    ];
    await writeFile(path.join(directory, stale), "stale");
    await Promise.all(
      unrelated.map((entry) => writeFile(path.join(directory, entry), "keep")),
    );

    await storage.recoverStagedDeletes([id]);

    const entries = await readdir(directory);
    expect(entries).not.toContain(stale);
    expect(entries).toEqual(expect.arrayContaining(unrelated));
  });
});
