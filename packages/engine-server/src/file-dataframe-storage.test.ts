import { tableFromArrays, tableFromIPC, tableToIPC } from "apache-arrow";
import { ReadStream } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

  it("stores more than 10,000 rows as one stream and loads complete batches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const id = "11111111-1111-4111-8111-111111111111";
    const rowCount = 12_345;

    async function* payloads(): AsyncIterable<Uint8Array> {
      for (let offset = 0; offset < rowCount; offset += 1_000) {
        const values = Array.from(
          { length: Math.min(1_000, rowCount - offset) },
          (_, index) => offset + index,
        );
        yield tableToIPC(tableFromArrays({ value: values }), "stream");
      }
    }

    await storage.saveBatches(id, payloads());

    const stored = await storage.load(id);
    expect(stored).not.toBeNull();
    expect(tableFromIPC(stored!).numRows).toBe(rowCount);

    let loadedRows = 0;
    let loadedPayloads = 0;
    for await (const payload of storage.loadBatches(id)) {
      const table = tableFromIPC(payload);
      expect(table.batches).toHaveLength(1);
      loadedRows += table.numRows;
      loadedPayloads += 1;
    }
    expect(loadedRows).toBe(rowCount);
    expect(loadedPayloads).toBe(13);
  });

  it("normalizes per-page dictionary ids while preserving string values", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const id = "11111111-1111-4111-8111-111111111111";
    const pages = [
      ["alpha", "beta", "alpha"],
      ["gamma", "delta", "gamma"],
      ["epsilon"],
    ];

    async function* payloads(): AsyncIterable<Uint8Array> {
      for (const values of pages) {
        yield tableToIPC(tableFromArrays({ value: values }), "stream");
      }
    }

    await storage.saveBatches(id, payloads());

    const stored = await storage.load(id);
    const values = tableFromIPC(stored!)
      .getChild("value")!
      .toArray()
      .map(String);
    expect(values).toEqual(pages.flat());
  });

  it("ignores a terminal empty page with an inferred Null schema", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const id = "11111111-1111-4111-8111-111111111111";

    await storage.saveBatches(
      id,
      (async function* () {
        yield tableToIPC(
          tableFromArrays({ value: ["alpha", "beta"] }),
          "stream",
        );
        yield tableToIPC(tableFromArrays({ value: [] }), "stream");
      })(),
    );

    const stored = await storage.load(id);
    const table = tableFromIPC(stored!);
    expect(table.schema.fields[0]?.type.toString()).toBe(
      "Dictionary<Int32, Utf8>",
    );
    expect(table.getChild("value")!.toArray().map(String)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("pulls batch payloads one at a time", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const id = "11111111-1111-4111-8111-111111111111";
    const payload = tableToIPC(tableFromArrays({ value: [1] }), "stream");
    let index = 0;
    let pendingPulls = 0;
    let maximumPendingPulls = 0;
    const batches: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            pendingPulls += 1;
            maximumPendingPulls = Math.max(maximumPendingPulls, pendingPulls);
            return new Promise<IteratorResult<Uint8Array>>((resolve) => {
              setImmediate(() => {
                pendingPulls -= 1;
                if (index >= 20) {
                  resolve({ done: true, value: undefined });
                  return;
                }
                index += 1;
                resolve({ done: false, value: payload });
              });
            });
          },
        };
      },
    };

    await storage.saveBatches(id, batches);

    expect(index).toBe(20);
    expect(maximumPendingPulls).toBe(1);
  });

  it("preserves an empty result schema", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const id = "11111111-1111-4111-8111-111111111111";
    const empty = tableFromArrays({ value: [] as number[] });

    await storage.saveBatches(
      id,
      (async function* () {
        yield tableToIPC(empty, "stream");
      })(),
    );

    const payloads: Uint8Array[] = [];
    for await (const payload of storage.loadBatches(id)) payloads.push(payload);
    expect(payloads).toHaveLength(1);
    const loaded = tableFromIPC(payloads[0]!);
    expect(loaded.numRows).toBe(0);
    expect(loaded.schema.fields.map((field) => field.name)).toEqual(["value"]);
  });

  it("keeps the prior generation and removes its temp after batch failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const directory = path.join(root, "frames");
    const storage = new FileDataFrameStorage(directory);
    const id = "11111111-1111-4111-8111-111111111111";
    const prior = new Uint8Array([9, 8, 7]);
    await storage.save(id, prior);

    await expect(
      storage.saveBatches(
        id,
        (async function* () {
          yield tableToIPC(tableFromArrays({ value: [1] }), "stream");
          yield tableToIPC(tableFromArrays({ value: ["mismatch"] }), "stream");
        })(),
      ),
    ).rejects.toThrow();

    expect(await storage.load(id)).toEqual(prior);
    expect(
      (await readdir(directory)).filter((entry) => entry.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("settles a delayed producer after an early filesystem failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const directory = path.join(root, "frames");
    const storage = new FileDataFrameStorage(directory);
    const id = "11111111-1111-4111-8111-111111111111";
    const prior = new Uint8Array([7, 8, 9]);
    await storage.save(id, prior);
    await mkdir(directory, { recursive: true });
    await chmod(directory, 0o500);

    try {
      await expect(
        storage.saveBatches(
          id,
          (async function* () {
            await new Promise<void>((resolve) => {
              setTimeout(resolve, 30);
            });
            yield tableToIPC(tableFromArrays({ value: [1] }), "stream");
          })(),
        ),
      ).rejects.toThrow();
    } finally {
      await chmod(directory, 0o700);
    }

    expect(await storage.load(id)).toEqual(prior);
    expect(
      (await readdir(directory)).filter((entry) => entry.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("closes the file stream when batch iteration stops early", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dashframe-frames-"));
    roots.push(root);
    const storage = new FileDataFrameStorage(path.join(root, "frames"));
    const id = "11111111-1111-4111-8111-111111111111";
    const destroyed = vi.spyOn(ReadStream.prototype, "destroy");
    await storage.saveBatches(
      id,
      (async function* () {
        yield tableToIPC(tableFromArrays({ value: [1] }), "stream");
        yield tableToIPC(tableFromArrays({ value: [2] }), "stream");
      })(),
    );

    for await (const payload of storage.loadBatches(id)) {
      expect(tableFromIPC(payload).numRows).toBe(1);
      break;
    }

    expect(destroyed).toHaveBeenCalled();
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
