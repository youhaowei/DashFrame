import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Float64, Table, tableToIPC, vectorFromArray } from "apache-arrow";
import { NativeDuckDBEngine } from "@dashframe/engine-server";
import { arrowIpcToJsonRows } from "@dashframe/engine-server/arrow-data-path";
import { FileDataFrameStorage } from "@dashframe/engine-server/file-dataframe-storage";
import type { DataTable, Field } from "@dashframe/types";
import type { HostContext } from "../context";
import { NativeTableLifecycle } from "../native-tables";
import {
  createInsightMaterializer,
  registerStoredFrame,
  type InsightMaterializerDependencies,
} from "./materializer";
import { productionMaterializerDependencies } from "./production";
import { DEFAULT_TRANSFER_LIMITS, MAX_WAITING_TRANSFERS } from "./transfer";

const owned: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of owned.splice(0).reverse()) await cleanup();
});

async function fixture(
  options: {
    failAfter?: number;
    limits?: InsightMaterializerDependencies["transferLimits"];
    pause?: (signal: AbortSignal) => Promise<void>;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "dashframe-stream-test-"));
  owned.push(() => rm(directory, { recursive: true, force: true }));
  const engine = new NativeDuckDBEngine();
  await engine.initialize();
  owned.push(() => engine.dispose());
  // Read results the way the data path does. The handle is taken before the
  // buffered entry points are barred below, so barring them still proves the
  // materialization lifecycle never reached for one.
  const rawQueryArrow = engine.queryArrow.bind(engine);
  const readRows = async (sql: string) =>
    arrowIpcToJsonRows(await rawQueryArrow(sql));
  // Production hands the host runtime `NativeTableLifecycle.engine`, which is
  // what declares itself the in-process native binding; the streaming
  // materialization path keys on that, not on method presence.
  const runtime = new NativeTableLifecycle(engine).engine;
  const storage = new FileDataFrameStorage(directory);
  // Full-buffer entry points must never be called by the streaming lifecycle.
  vi.spyOn(storage, "load").mockRejectedValue(
    new Error("full file read forbidden"),
  );
  vi.spyOn(engine, "queryArrow").mockRejectedValue(
    new Error("full result export forbidden"),
  );
  vi.spyOn(engine, "registerArrowTable").mockRejectedValue(
    new Error("full registration forbidden"),
  );
  const tableId = randomUUID(),
    fieldId = randomUUID();
  const fields: Field[] = [
    {
      id: fieldId,
      tableId,
      name: "Value",
      columnName: "value",
      type: "number",
    },
  ];
  const table: DataTable = {
    id: tableId,
    name: "Source",
    dataSourceId: randomUUID(),
    table: "public.source",
    fields,
    metrics: [],
    createdAt: 0,
  };
  let emitted = 0,
    closed = false,
    pointer = "old-frame";
  const observed: number[] = [];
  const transferCompleted = vi.fn();
  const publish = vi.fn(async () => {
    pointer = "new-frame";
  });
  const dependencies: InsightMaterializerDependencies = {
    ...productionMaterializerDependencies(),
    storage: () => storage,
    runtime: () => runtime,
    resolveSource: async (_ctx, _id, signal) => ({
      table,
      fields,
      rowCount: 0,
      provenance: { connectorKind: "postgres", bindingVersion: "v1" },
      batches: (async function* () {
        const previousPointer = pointer;
        try {
          for (let start = 0; start < 25_001; start += 2048) {
            signal!.throwIfAborted();
            if (options.failAfter !== undefined && emitted >= options.failAfter)
              throw new Error("provider failed");
            if (options.pause) await options.pause(signal!);
            const values = Array.from(
              { length: Math.min(2048, 25_001 - start) },
              (_, i) => start + i,
            );
            observed.push(values.length);
            emitted += values.length;
            expect(pointer).toBe(previousPointer);
            yield tableToIPC(
              new Table({ value: vectorFromArray(values, new Float64()) }),
            );
          }
        } finally {
          closed = true;
        }
      })(),
    }),
    publish,
    fingerprint: () => "stream-test",
    coalescingScope: (_ctx, target, insight) =>
      JSON.stringify([target, insight]),
    uuid: randomUUID,
    now: Date.now,
    tableName: (id) => `df_${id.replaceAll("-", "_")}`,
    sharedOperationTimeoutMs: 120_000,
    completedReplayMs: 0,
    transferLimits: options.limits,
    transferCompleted,
  };
  const materializer = createInsightMaterializer(dependencies);
  const run = (limit?: number) =>
    materializer.materialize({
      ctx: {} as HostContext,
      target: { kind: "ephemeral" },
      insight: {
        baseTableId: tableId,
        selectedFields: [fieldId],
        metrics: [],
        ...(limit === undefined ? {} : { limit }),
      },
    });
  return {
    storage,
    runtime,
    readRows,
    dependencies,
    run,
    publish,
    observed,
    transferCompleted,
    state: () => ({ closed, emitted, pointer }),
  };
}

describe("streaming immutable materialization", () => {
  it("serializes distinct sibling requests with a bounded queue and coalesces identical work", async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const h = await fixture({ pause: async () => gate });
    const resolve = vi.spyOn(h.dependencies, "resolveSource");
    const first = h.run();
    await vi.waitFor(() => expect(h.observed).toHaveLength(0));
    const queued = Array.from({ length: MAX_WAITING_TRANSFERS }, (_, index) =>
      h.run(index + 1),
    );
    expect(h.run(1)).toBe(queued[0]);
    try {
      await expect(h.run(MAX_WAITING_TRANSFERS + 1)).rejects.toThrow(
        "FETCH_BUSY",
      );
      expect(resolve).toHaveBeenCalledOnce();
    } finally {
      resume();
    }
    expect((await first).rowCount).toBe(25_001);
    const results = await Promise.all(queued);
    expect(results.map((result) => result.rowCount)).toEqual([1, 2, 3, 4]);
    expect(h.publish).toHaveBeenCalledTimes(5);
  });

  it("expires queued work without starting its source or cancelling the active run", async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const h = await fixture({ pause: async () => gate });
    const resolve = vi.spyOn(h.dependencies, "resolveSource");
    const active = h.run();
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    h.dependencies.transferLimits = {
      ...DEFAULT_TRANSFER_LIMITS,
      timeoutMs: 25,
    };
    try {
      await expect(h.run(1)).rejects.toThrow("FETCH_DEADLINE_EXCEEDED");
      expect(resolve).toHaveBeenCalledOnce();
    } finally {
      resume();
    }
    expect((await active).rowCount).toBe(25_001);
    h.dependencies.transferLimits = DEFAULT_TRANSFER_LIMITS;
    expect((await h.run(2)).rowCount).toBe(2);
    expect(h.publish).toHaveBeenCalledTimes(2);
  });

  it.each(["stream", "loadBatches"] as const)(
    "persists and queries all 25001 rows through %s without buffering",
    async (readPath) => {
      const h = await fixture();
      if (readPath === "loadBatches") {
        const storage = {
          save: h.storage.save.bind(h.storage),
          load: h.storage.load.bind(h.storage),
          delete: h.storage.delete.bind(h.storage),
          exists: h.storage.exists.bind(h.storage),
          list: h.storage.list.bind(h.storage),
          getUsage: h.storage.getUsage.bind(h.storage),
          saveBatches: h.storage.saveBatches.bind(h.storage),
          loadBatches: h.storage.loadBatches.bind(h.storage),
        };
        h.dependencies.storage = () => storage;
      }
      const result = await h.run();
      expect(result.rowCount).toBe(25_001);
      expect(h.observed).toHaveLength(13);
      expect(Math.max(...h.observed)).toBe(2048);
      expect(h.state()).toEqual({
        closed: true,
        emitted: 25_001,
        pointer: "new-frame",
      });
      expect(h.publish).toHaveBeenCalledOnce();
      const name = `df_${result.dataFrameId.replaceAll("-", "_")}`;
      const column = result.schema[0]!.id;
      const aggregate = await h.readRows(
        `SELECT count(*) AS n, max("${column}") AS tail, sum("${column}") AS total FROM "${name}"`,
      );
      expect(aggregate[0]).toMatchObject({
        n: 25_001,
        tail: 25_000,
        total: 312_512_500,
      });
      await h.runtime.unregisterTable(name);
      await registerStoredFrame(
        h.dependencies.storage({} as HostContext),
        h.runtime,
        name,
        result.dataFrameId,
      );
      expect(
        (await h.readRows(`SELECT count(*) AS n FROM "${name}"`))[0]?.n,
      ).toBe(25_001);
      expect(h.transferCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "ready", rows: 50_002 }),
      );
    },
  );

  it("removes an unpublished prefix and closes the source after provider failure", async () => {
    const h = await fixture({ failAfter: 12_288 });
    await expect(h.run()).rejects.toThrow("provider failed");
    expect(h.state()).toMatchObject({ closed: true, pointer: "old-frame" });
    expect(await h.storage.list()).toEqual([]);
    expect(h.runtime.getTableNames()).toEqual([]);
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("aborts a blocked producer on deadline and preserves the old pointer", async () => {
    let startProducer!: () => void;
    const started = new Promise<void>((resolve) => {
      startProducer = resolve;
    });
    const h = await fixture({
      limits: { ...DEFAULT_TRANSFER_LIMITS, timeoutMs: 25 },
      pause: (signal) =>
        new Promise((_, reject) => {
          startProducer();
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
          if (signal.aborted) reject(signal.reason);
        }),
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const outcome = h.run().catch((error: unknown) => error);
      await started;
      await vi.advanceTimersByTimeAsync(25);
      expect(await outcome).toMatchObject({
        message: "FETCH_DEADLINE_EXCEEDED",
      });
      expect(h.state()).toMatchObject({ closed: true, pointer: "old-frame" });
      expect(await h.storage.list()).toEqual([]);
      expect(h.publish).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["batchBytes", "FETCH_BATCH_BYTES_EXCEEDED"],
    ["runBytes", "FETCH_BYTE_BUDGET_EXCEEDED"],
    ["storageBytes", "FETCH_STORAGE_BUDGET_EXCEEDED"],
  ] as const)(
    "rejects %s exhaustion without publication",
    async (key, code) => {
      const h = await fixture({
        limits: { ...DEFAULT_TRANSFER_LIMITS, [key]: 100 },
      });
      await expect(h.run()).rejects.toThrow(code);
      expect(await h.storage.list()).toEqual([]);
      expect(h.publish).not.toHaveBeenCalled();
      expect(h.state().closed).toBe(true);
    },
  );
});
