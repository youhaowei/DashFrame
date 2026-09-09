import { DuckDBInstance } from "@duckdb/node-api";
import {
  Bool,
  DateDay,
  DateMillisecond,
  Float64,
  Int32,
  Table,
  tableFromIPC,
  tableToIPC,
  TimestampMillisecond,
  Uint64,
  Utf8,
  vectorFromArray,
} from "apache-arrow";
import fs from "node:fs/promises";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { arrowIpcToJsonRows } from "./arrow-data-path";
import { NativeDuckDBEngine } from "./native-engine";

/**
 * The engine speaks Arrow only. JSON rows are decoded where transport decodes
 * them, so these tests use the same decoder the data path uses rather than a
 * second row-shaped engine method.
 */
async function queryRows(
  engine: NativeDuckDBEngine,
  sql: string,
  params?: readonly unknown[],
): Promise<Record<string, unknown>[]> {
  return arrowIpcToJsonRows(await engine.queryArrow(sql, params));
}

const MS_PER_HOUR = 3_600_000;

/**
 * A pair of Arrow-stream sources that each block until BOTH have started.
 * The pair can only finish on its own if the two registrations held their
 * leases AT THE SAME TIME — so "both settled" means overlap and "nothing
 * settled" means the second never got past the lock. `open()` releases the
 * barrier by hand when a test needs the serialized pair to drain afterwards.
 */
function overlapBarrier(arrow: Uint8Array): {
  source: () => AsyncGenerator<Uint8Array>;
  open: () => void;
} {
  let started = 0;
  let openGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  return {
    source: () =>
      (async function* () {
        started += 1;
        if (started === 2) openGate();
        await gate;
        yield arrow;
      })(),
    open: () => openGate(),
  };
}

describe("NativeDuckDBEngine — real native DuckDB (Stage 3)", () => {
  let engine: NativeDuckDBEngine | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    await engine?.dispose();
    engine = null;
  });

  it("is not ready until initialized", () => {
    engine = new NativeDuckDBEngine();
    expect(engine.isReady()).toBe(false);
  });

  it("executes a SQL query and returns rows", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    expect(engine.isReady()).toBe(true);

    const result = await queryRows(
      engine,
      "SELECT range AS n FROM range(3) ORDER BY n",
    );
    expect(result.length).toBe(3);
    expect(Object.keys(result[0]!)).toEqual(["n"]);
    expect(result.map((r) => Number(r.n))).toEqual([0, 1, 2]);
  });

  it("does not corrupt a literal '?' when binding positional params (native binding, not text scan)", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    // A literal question mark in a string AND a real placeholder. Text-scanning
    // every `?` would consume the literal as a placeholder and shift binding,
    // corrupting both columns. Native binding only fills the real placeholder.
    const ipc = await engine.queryArrow("SELECT '?' AS marker, ? AS v", [42]);
    const table = tableFromIPC(ipc);

    expect(table.numRows).toBe(1);
    expect(table.getChild("marker")?.toArray()).toEqual(["?"]);
    expect([...table.getChild("v")!.toArray()].map(Number)).toEqual([42]);
  });

  it("streams every native chunk, including the tail, as standalone IPC", async () => {
    engine = new NativeDuckDBEngine();
    const batches: Uint8Array[] = [];
    for await (const batch of engine.queryArrowBatches(
      "SELECT range::DOUBLE AS value FROM range(25001)",
    )) {
      batches.push(batch);
    }

    const tables = batches.map((batch) => tableFromIPC(batch));
    expect(tables.length).toBeGreaterThan(1);
    expect(tables.reduce((rows, table) => rows + table.numRows, 0)).toBe(
      25_001,
    );
    expect(tables.at(-1)?.getChild("value")?.get(-1)).toBeUndefined();
    const tail = tables.at(-1)!;
    expect(tail.getChild("value")?.get(tail.numRows - 1)).toBe(25_000);
  });

  it("yields a typed standalone IPC batch for a zero-row query", async () => {
    engine = new NativeDuckDBEngine();
    const batches: Uint8Array[] = [];
    for await (const batch of engine.queryArrowBatches(
      "SELECT 1::DOUBLE AS value WHERE false",
    )) {
      batches.push(batch);
    }
    expect(batches).toHaveLength(1);
    const table = tableFromIPC(batches[0]!);
    expect(table.numRows).toBe(0);
    expect(table.schema.fields.map((field) => field.name)).toEqual(["value"]);
  });

  it("enforces the sandbox row limit across streamed result chunks", async () => {
    engine = new NativeDuckDBEngine({
      sandboxLimits: {
        memoryBytes: 64 * 1024 * 1024,
        threads: 1,
        maxResultRows: 2_048,
      },
    });
    let yieldedRows = 0;
    const consume = async () => {
      for await (const batch of engine!.queryArrowBatches(
        "SELECT range::DOUBLE AS value FROM range(5000)",
      )) {
        yieldedRows += tableFromIPC(batch).numRows;
      }
    };

    await expect(consume()).rejects.toThrow(
      "Sandbox result row limit exceeded",
    );
    expect(yieldedRows).toBeLessThanOrEqual(2_048);
  });

  it("stops a streaming native query when its signal is cancelled", async () => {
    engine = new NativeDuckDBEngine();
    const controller = new AbortController();
    const iterator = engine
      .queryArrowBatches(
        "SELECT range::DOUBLE AS value FROM range(100000)",
        [],
        controller.signal,
      )
      [Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    controller.abort(new Error("cancelled"));
    await expect(iterator.next()).rejects.toThrow("cancelled");
  });

  it("registers a chunked raw IPC stream atomically and preserves its tail", async () => {
    engine = new NativeDuckDBEngine();
    const ipc = tableToIPC(
      new Table({
        value: vectorFromArray(
          Array.from({ length: 25_001 }, (_, index) => index),
          new Float64(),
        ),
      }),
    );
    const chunks = (async function* () {
      for (let offset = 0; offset < ipc.byteLength; offset += 4093) {
        yield ipc.subarray(offset, offset + 4093);
      }
    })();
    await engine.registerArrowStream("df_streamed", chunks);

    const result = await queryRows(
      engine,
      "SELECT count(*) AS n, max(value) AS tail, sum(value) AS total FROM df_streamed",
    );
    expect(result[0]).toMatchObject({
      n: 25_001,
      tail: 25_000,
      total: 312_512_500,
    });
  });

  it("keeps the previous table when a raw IPC stream fails", async () => {
    engine = new NativeDuckDBEngine();
    const original = tableToIPC(
      new Table({ value: vectorFromArray([7], new Float64()) }),
    );
    await engine.registerArrowTable("df_atomic_stream", original);
    const replacement = tableToIPC(
      new Table({ value: vectorFromArray([1, 2, 3], new Float64()) }),
    );
    const failing = (async function* () {
      yield replacement.subarray(0, Math.floor(replacement.byteLength / 2));
      throw new Error("source failed");
    })();

    await expect(
      engine.registerArrowStream("df_atomic_stream", failing),
    ).rejects.toThrow("source failed");
    expect(
      await queryRows(engine, "SELECT value FROM df_atomic_stream"),
    ).toEqual([{ value: 7 }]);
  });

  it("is not usable after dispose()", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    expect(engine.isReady()).toBe(true);

    await engine.dispose();

    // isReady() must return false — the engine's phase is terminal and the
    // instance is closed.
    expect(engine.isReady()).toBe(false);
    // queryArrow() must throw rather than silently return empty bytes, so
    // callers discover the misuse instead of seeing a ghost success.
    await expect(engine.queryArrow("SELECT 1")).rejects.toThrow(
      "NativeDuckDBEngine not initialized",
    );
  });

  it("registerArrowTable() after dispose() fails closed instead of resurrecting", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    await engine.dispose();

    // Re-arming the lifecycle controller inside initialize() would build a
    // fresh instance and connection here that nothing will ever close — the
    // owner already disposed. Disposal is terminal for every entry point.
    await expect(
      engine.registerArrowTable(
        "df_after_dispose",
        tableToIPC(
          new Table({ id: vectorFromArray([1, 2], new Int32()) }),
          "stream",
        ),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.isReady()).toBe(false);
    expect(engine.hasTable("df_after_dispose")).toBe(false);
  });

  it("unregisterTable() after dispose() fails closed instead of resurrecting", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    await engine.dispose();

    await expect(engine.unregisterTable("df_gone")).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(engine.isReady()).toBe(false);
  });

  it("rejects table operations that arrive while dispose() is tearing down", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    // Hold a registration open so dispose() parks on `operationsIdle` with the
    // connection still live — the window a guard placed after initialize()'s
    // `this.connection` early return would wave callers straight through.
    let releaseProducer!: () => void;
    const producerReleased = new Promise<void>((resolve) => {
      releaseProducer = resolve;
    });
    let producerStarted!: () => void;
    const producerHasStarted = new Promise<void>((resolve) => {
      producerStarted = resolve;
    });
    const source = (async function* () {
      producerStarted();
      await producerReleased;
      yield new Uint8Array();
    })();
    const inFlight = engine.registerArrowStream("df_holding", source);
    await producerHasStarted;

    const disposing = engine.dispose();

    // Must reject promptly rather than queue behind the in-flight
    // registration's lock on the same table name.
    const arrow = tableToIPC(
      new Table({ id: vectorFromArray([1], new Int32()) }),
      "stream",
    );
    const settle = (promise: Promise<unknown>) =>
      Promise.race([
        promise.then(
          () => "resolved",
          (error: { name?: string }) =>
            error?.name === "AbortError" ? "aborted" : "other",
        ),
        new Promise((resolve) => {
          setTimeout(() => resolve("pending"), 250);
        }),
      ]);

    expect(await settle(engine.registerArrowTable("late", arrow))).toBe(
      "aborted",
    );
    expect(await settle(engine.unregisterTable("df_holding"))).toBe("aborted");

    releaseProducer();
    await expect(inFlight).rejects.toMatchObject({ name: "AbortError" });
    await disposing;
    expect(engine.isReady()).toBe(false);
  });

  it("rejects direct queries that arrive while dispose() is tearing down", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    let releaseProducer!: () => void;
    const producerReleased = new Promise<void>((resolve) => {
      releaseProducer = resolve;
    });
    let producerStarted!: () => void;
    const producerHasStarted = new Promise<void>((resolve) => {
      producerStarted = resolve;
    });
    const source = (async function* () {
      producerStarted();
      await producerReleased;
      yield new Uint8Array();
    })();
    const inFlight = engine.registerArrowStream("df_holding_query", source);
    await producerHasStarted;

    const disposing = engine.dispose();

    // queryArrow() opens a connection of its own. Unenrolled, dispose() would
    // see no tracked operation and could close the instance underneath it.
    await expect(engine.queryArrow("SELECT 1")).rejects.toMatchObject({
      name: "AbortError",
    });

    releaseProducer();
    await expect(inFlight).rejects.toMatchObject({ name: "AbortError" });
    await disposing;
    expect(engine.isReady()).toBe(false);
  });

  it("dispose() before initialize() on a fresh engine leaves it dead", async () => {
    engine = new NativeDuckDBEngine();

    // dispose() yields at `await this.initPromise` even when that field is
    // null, so an initialize() landing in that window would otherwise pass the
    // lifecycle guard and assign a live instance the teardown already passed.
    const disposing = engine.dispose();
    const initializing = engine.initialize();

    await disposing;
    await expect(initializing).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.isReady()).toBe(false);
  });

  it(
    "interrupts an in-flight read so dispose() can finish",
    { timeout: 20_000 },
    async () => {
      engine = new NativeDuckDBEngine();
      await engine.initialize();

      // Big enough that it cannot finish on its own before dispose() is called.
      // Enrolled but uninterruptible, dispose() would block on `operationsIdle`
      // until this completes — hanging desktop and server shutdown, both of
      // which await dispose().
      const reading = engine
        .queryArrow(
          "SELECT count(*) FROM range(2000000) t1, range(2000000) t2, range(2000000) t3",
        )
        .then(
          () => "resolved" as const,
          () => "failed" as const,
        );
      // Let the native read actually start before teardown begins.
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });

      await engine.dispose();

      expect(engine.isReady()).toBe(false);
      expect(await reading).toBe("failed");
    },
  );

  it("dispose() is idempotent — calling it twice does not throw", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    // First dispose closes connection + instance.
    await engine.dispose();
    // Second dispose must not throw even though handles are already gone —
    // e.g. a finally-block and an afterEach teardown may both call dispose().
    await expect(engine.dispose()).resolves.toBeUndefined();
    expect(engine.isReady()).toBe(false);
  });

  it("dispose() on an uninitialized engine does not throw", async () => {
    engine = new NativeDuckDBEngine();
    // Never called initialize() — nothing to close, must be a no-op.
    await expect(engine.dispose()).resolves.toBeUndefined();
  });

  it("dispose() during an in-flight initialize() leaves the engine dead, not live", async () => {
    engine = new NativeDuckDBEngine();
    // dispose() races initialize(): without awaiting the init latch, the init
    // closure would assign a live connection AFTER teardown ran — an engine
    // alive past disposal (e.g. Electron before-quit during DuckDB startup).
    const init = engine.initialize();
    await engine.dispose();
    await init;

    expect(engine.isReady()).toBe(false);
    await expect(engine.queryArrow("SELECT 1")).rejects.toThrow(
      "NativeDuckDBEngine not initialized",
    );
  });

  it("dispose() closes a streaming query paused at a yielded batch", async () => {
    engine = new NativeDuckDBEngine();
    const iterator = engine
      .queryArrowBatches("SELECT range FROM range(5000)")
      [Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);

    const disposed = engine.dispose().then(() => "disposed" as const);
    const outcome = await Promise.race([
      disposed,
      new Promise<"blocked">((resolve) => {
        setTimeout(() => resolve("blocked"), 500);
      }),
    ]);

    expect(outcome).toBe("disposed");
    expect(engine.isReady()).toBe(false);
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });

  it("dispose() cancels registration when the IPC producer never settles", async () => {
    engine = new NativeDuckDBEngine();
    let startNext!: () => void;
    const nextStarted = new Promise<void>((resolve) => {
      startNext = resolve;
    });
    let closeRequested = false;
    const stalled: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            startNext();
            return new Promise<IteratorResult<Uint8Array>>(() => {});
          },
          return() {
            closeRequested = true;
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };
    const registration = engine.registerArrowStream("df_stalled", stalled);
    const registrationOutcome = registration.catch((error: unknown) => error);
    await nextStarted;

    const disposed = engine.dispose().then(() => "disposed" as const);
    const outcome = await Promise.race([
      disposed,
      new Promise<"blocked">((resolve) => {
        setTimeout(() => resolve("blocked"), 500);
      }),
    ]);

    expect(outcome).toBe("disposed");
    expect(await registrationOutcome).toMatchObject({ name: "AbortError" });
    expect(closeRequested).toBe(true);
    expect(engine.hasTable("df_stalled")).toBe(false);
  });

  it("registration awaiting initialize rejects the lifecycle abort after disposal", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    let resumeInitialize!: () => void;
    let signalInitialize!: () => void;
    const initializeStarted = new Promise<void>((resolve) => {
      signalInitialize = resolve;
    });
    const initializeResumed = new Promise<void>((resolve) => {
      resumeInitialize = resolve;
    });
    vi.spyOn(engine, "initialize").mockImplementationOnce(async () => {
      signalInitialize();
      await initializeResumed;
    });
    const source = (async function* () {
      yield new Uint8Array();
    })();
    const registration = engine.registerArrowStream("df_disposed", source);
    await initializeStarted;

    await engine.dispose();
    resumeInitialize();

    await expect(registration).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.hasTable("df_disposed")).toBe(false);
  });

  it("is idempotent under concurrent initialize() — one instance, none leaked", async () => {
    engine = new NativeDuckDBEngine();
    // Two callers race before the first await resolves; both must converge on
    // one DuckDBInstance rather than each creating their own.
    await Promise.all([engine.initialize(), engine.initialize()]);
    expect(engine.isReady()).toBe(true);

    // A query still works against the single surviving instance.
    const result = await queryRows(engine, "SELECT 1 AS one");
    expect(result.map((r) => Number(r.one))).toEqual([1]);
  });

  it("produces Arrow IPC that roundtrips through apache-arrow", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    const ipc = await engine.queryArrow(
      "SELECT range::int AS id, ('row' || range) AS label FROM range(3)",
    );
    const table = tableFromIPC(ipc);

    expect(table.numRows).toBe(3);
    expect(table.schema.fields.map((f) => f.name)).toEqual(["id", "label"]);
    expect([...table.getChild("id")!.toArray()].map(Number)).toEqual([0, 1, 2]);
    expect(table.getChild("label")?.toArray()).toEqual([
      "row0",
      "row1",
      "row2",
    ]);
  });

  it("a leased connection that fails to disconnect still hands back the lock and refcount", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    const internals = engine as unknown as {
      instance: { connect(): Promise<{ disconnectSync(): void }> };
    };
    const rawInstance = internals.instance;
    // Make the NEXT leased connection's disconnectSync() throw on release.
    internals.instance = new Proxy(rawInstance, {
      get(target, prop, receiver) {
        if (prop !== "connect") return Reflect.get(target, prop, receiver);
        return async () => {
          const conn = await target.connect();
          conn.disconnectSync = () => {
            throw new Error("disconnect failed");
          };
          return conn;
        };
      },
    });
    const arrow = tableToIPC(
      new Table({ v: vectorFromArray([1], new Int32()) }),
      "stream",
    );
    await expect(
      engine.registerArrowStream(
        "df_bad_disconnect",
        (async function* () {
          yield arrow;
        })(),
      ),
    ).rejects.toThrow("disconnect failed");
    internals.instance = rawInstance;

    // The lock and the refcount must both be free: a queued registration and
    // dispose() settle instead of waiting on a lease that already ended.
    const settles = (promise: Promise<unknown>) =>
      Promise.race([
        promise.then(() => "settled"),
        new Promise((resolve) => {
          setTimeout(() => resolve("stuck"), 500);
        }),
      ]);
    expect(await settles(engine.registerArrowTable("df_next", arrow))).toBe(
      "settled",
    );
    expect(await settles(engine.dispose())).toBe("settled");
    expect(engine.isReady()).toBe(false);
  });

  it("dispose() completes and closes the instance even when a leased connection refuses to disconnect", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    // Teardown no longer disconnects anything: every operation closes its own
    // connection on release. The hazard that survives is a connection whose
    // close FAILED — the instance must still be closed exactly once, and
    // disposal must stay terminal, rather than the failure leaving a live
    // instance nothing will ever reclaim.
    const internals = engine as unknown as {
      instance: {
        connect(): Promise<{ disconnectSync(): void }>;
        closeSync(): void;
      };
    };
    const rawInstance = internals.instance;
    internals.instance = new Proxy(rawInstance, {
      get(target, prop, receiver) {
        if (prop !== "connect") return Reflect.get(target, prop, receiver);
        return async () => {
          const conn = await target.connect();
          conn.disconnectSync = () => {
            throw new Error("disconnect failed");
          };
          return conn;
        };
      },
    });
    await expect(engine.queryArrow("SELECT 1")).rejects.toThrow(
      "disconnect failed",
    );
    internals.instance = rawInstance;
    const closeSync = vi.spyOn(rawInstance, "closeSync");

    await expect(engine.dispose()).resolves.toBeUndefined();
    expect(closeSync).toHaveBeenCalledTimes(1);
    expect(engine.isReady()).toBe(false);
    await expect(engine.dispose()).resolves.toBeUndefined();
    await expect(engine.initialize()).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("an initialize() that fails while dispose() is in flight does not reopen the engine", async () => {
    engine = new NativeDuckDBEngine({
      databasePath: "/nonexistent/dir/db.duckdb",
    });
    // The failing init must not reset the lifecycle to idle underneath a
    // dispose() that already began — that would let a later initialize()
    // build an instance nothing will close.
    const init = engine.initialize();
    const disposing = engine.dispose();
    // Retry in the same tick the failure surfaces, while teardown is still
    // parked on the failed init latch. The retry must see a disposing engine,
    // not an idle one — otherwise it starts an init teardown has walked past.
    const retry = init.then(
      () => {
        throw new Error("init unexpectedly succeeded");
      },
      () => engine!.initialize(),
    );
    await disposing;

    await expect(retry).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.isReady()).toBe(false);
    expect((engine as unknown as { instance: unknown }).instance).toBeNull();
  });

  it("registerArrowStream() with an already-cancelled signal never starts DuckDB", async () => {
    engine = new NativeDuckDBEngine();
    const source = (async function* () {
      yield new Uint8Array();
    })();

    await expect(
      engine.registerArrowStream("df_cancelled", source, AbortSignal.abort()),
    ).rejects.toMatchObject({ name: "AbortError" });
    // The caller had already given up; building an instance for it would be
    // startup cost spent on nothing.
    expect(engine.isReady()).toBe(false);
    expect((engine as unknown as { instance: unknown }).instance).toBeNull();
  });

  it("a query resuming into a dispose() queued ahead of it never starts its statement", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    const internals = engine as unknown as {
      instance: { connect(): Promise<Record<string, unknown>> };
    };
    const rawInstance = internals.instance;
    // Record every native call the operation's own connection makes, so the
    // test can assert the statement never started.
    const nativeCalls: string[] = [];
    internals.instance = new Proxy(rawInstance, {
      get(target, prop, receiver) {
        if (prop !== "connect") return Reflect.get(target, prop, receiver);
        return async () => {
          const conn = await target.connect();
          return new Proxy(conn, {
            get(obj, name, self) {
              const value = Reflect.get(obj, name, self) as unknown;
              if (typeof value !== "function") return value;
              return (...args: unknown[]) => {
                nativeCalls.push(String(name));
                return Reflect.apply(value, obj, args);
              };
            },
          });
        };
      },
    });

    // Acquisition yields once before the callback runs. A dispose() landing
    // in that microtask has already interrupted a statement that does not
    // exist yet; the query must notice and stop, not run unstoppable through
    // teardown.
    let disposing!: Promise<void>;
    queueMicrotask(() => {
      disposing = engine!.dispose();
    });
    await expect(engine.queryArrow("SELECT 1")).rejects.toMatchObject({
      name: "AbortError",
    });
    await disposing;
    internals.instance = rawInstance;

    expect(nativeCalls).not.toContain("runAndReadAll");
    expect(engine.isReady()).toBe(false);
  });

  it("dispose() keeps the instance and retries when closeSync() fails", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    const internals = engine as unknown as {
      instance: { closeSync(): void } | null;
    };
    const closeSync = vi
      .spyOn(internals.instance!, "closeSync")
      .mockImplementationOnce(() => {
        throw new Error("close failed");
      });

    // A close that fails leaves native threads and any file lock live;
    // swallowing it and dropping the handle would make that leak permanent.
    await expect(engine.dispose()).rejects.toThrow("close failed");
    expect(internals.instance).not.toBeNull();
    expect(engine.isReady()).toBe(false);

    await expect(engine.dispose()).resolves.toBeUndefined();
    expect(closeSync).toHaveBeenCalledTimes(2);
    expect(internals.instance).toBeNull();
    await expect(engine.initialize()).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("reaches native handles only from inside an enrolled lifecycle operation", async () => {
    // Structural pin for the lifecycle contract on OPERATIONS: every native
    // call an operation makes — through the instance, or through the
    // connection it opens from the instance — must happen while the engine
    // has an operation enrolled (`activeNativeOperations > 0`); that
    // enrolment is what makes dispose() wait instead of closing the handle
    // underneath the call. The lifecycle methods are out of scope by
    // construction: openInstance() runs before the proxy is installed and
    // teardown() after it is removed, since both legitimately touch the
    // instance with nothing enrolled. The proxy records any native call made
    // unenrolled, so an operation that reaches a handle without going through
    // the lease fails here even though it would "work" on a live engine.
    //
    // Every method on the class must run inside this test, so a new entry
    // point cannot skip the check silently: spies on the prototype fail the
    // test for any method the exercise block below never reached.
    const notNativeTouching = new Set([
      "constructor",
      "isReady",
      "hasTable",
      "getTableNames",
      "dispose", // runs in afterEach, after the raw handles are restored
      "teardown", // dispose()'s body
    ]);
    const prototype = NativeDuckDBEngine.prototype as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    const spies = Object.getOwnPropertyNames(prototype)
      .filter(
        (name) =>
          !notNativeTouching.has(name) && typeof prototype[name] === "function",
      )
      .map((name) => [name, vi.spyOn(prototype, name)] as const);

    engine = new NativeDuckDBEngine();
    await engine.initialize();
    const internals = engine as unknown as {
      instance: object;
      activeNativeOperations: number;
    };
    const rawInstance = internals.instance;
    const unenrolled: string[] = [];
    const guarded = <T extends object>(target: T, label: string): T =>
      new Proxy(target, {
        get(obj, prop, receiver) {
          const value = Reflect.get(obj, prop, receiver) as unknown;
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (internals.activeNativeOperations === 0) {
              unenrolled.push(`${label}.${String(prop)}`);
            }
            const result: unknown = Reflect.apply(value, obj, args);
            // Every connection is born from `instance.connect()`; guard each
            // one so every operation is held to the same rule.
            return prop === "connect" && result instanceof Promise
              ? result.then((conn: object) => guarded(conn, "connection"))
              : result;
          };
        },
      });
    internals.instance = guarded(rawInstance, "instance");

    try {
      const arrow = tableToIPC(
        new Table({ v: vectorFromArray([1, 2], new Int32()) }),
        "stream",
      );
      await engine.queryArrow("SELECT 1");
      await engine.queryArrow("SELECT ? AS v", [1]);
      await engine.registerArrowTable("df_enrolled", arrow);
      await engine.registerArrowStream(
        "df_enrolled_stream",
        (async function* () {
          yield arrow;
        })(),
      );
      for await (const batch of engine.queryArrowBatches(
        "SELECT * FROM df_enrolled",
      )) {
        expect(tableFromIPC(batch).numRows).toBeGreaterThan(0);
      }
      await engine.unregisterTable("df_enrolled");
      await engine.unregisterTable("df_enrolled_stream");
      // The appender-failure path closes a failed appender and discards its
      // connection; it must do so from inside the lease like everything else.
      await expect(
        engine.registerArrowTable(
          "df_overflow",
          tableToIPC(
            new Table({
              n: vectorFromArray([9223372036854775808n], new Uint64()),
            }),
            "stream",
          ),
        ),
      ).rejects.toThrow();

      expect(unenrolled).toEqual([]);
      const unexercised = spies
        .filter(([, spy]) => spy.mock.calls.length === 0)
        .map(([name]) => name);
      expect(unexercised, "add the new method to the exercise block").toEqual(
        [],
      );
    } finally {
      internals.instance = rawInstance;
    }
  });

  it("runs registrations of different table names concurrently", async () => {
    // The lock is per table name, so two registrations that name different
    // tables must be in their critical sections AT THE SAME TIME — not merely
    // both eventually succeed. Each source blocks until both have started, so
    // the pair can only finish if both leases were granted concurrently. A
    // global lock (the old shape) never lets the second generator start, and
    // this test times out instead of passing.
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    const arrow = tableToIPC(
      new Table({ v: vectorFromArray([1, 2, 3], new Int32()) }),
      "stream",
    );
    const barrier = overlapBarrier(arrow);

    const both = Promise.all([
      engine.registerArrowStream("df_parallel_a", barrier.source()),
      engine.registerArrowStream("df_parallel_b", barrier.source()),
    ]);
    const outcome = await Promise.race([
      both.then(
        () => "concurrent" as const,
        () => "failed" as const,
      ),
      new Promise<"serialized">((resolve) => {
        setTimeout(() => resolve("serialized"), 2_000);
      }),
    ]);

    expect(outcome).toBe("concurrent");
    expect(engine.hasTable("df_parallel_a")).toBe(true);
    expect(engine.hasTable("df_parallel_b")).toBe(true);
    for (const name of ["df_parallel_a", "df_parallel_b"]) {
      const rows = await queryRows(
        engine,
        `SELECT COUNT(*) AS cnt FROM "${name}"`,
      );
      expect(Number(rows[0]?.cnt)).toBe(3);
    }
  });

  it("serializes registrations whose names differ only in case", async () => {
    // DuckDB identifiers are case-insensitive even when quoted, so "Sales" and
    // "sales" are ONE catalog entry: letting them run concurrently reproduces
    // the write-write conflict the lock exists to prevent. Same barrier as the
    // test above, inverted — if the two ever hold their leases at the same
    // time the gate opens and both finish fast; correct behaviour is that the
    // second cannot start until the first has released, so the race times out.
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    const arrow = tableToIPC(
      new Table({ v: vectorFromArray([1, 2, 3], new Int32()) }),
      "stream",
    );
    const barrier = overlapBarrier(arrow);

    const both = Promise.all([
      engine.registerArrowStream("df_Case_Lock", barrier.source()),
      engine.registerArrowStream("df_case_lock", barrier.source()),
    ]);
    const outcome = await Promise.race([
      both.then(
        () => "concurrent" as const,
        () => "failed" as const,
      ),
      new Promise<"serialized">((resolve) => {
        setTimeout(() => resolve("serialized"), 750);
      }),
    ]);
    expect(outcome).toBe("serialized");

    // Release the holder so the pair can drain, and prove both registrations
    // still complete once they are properly ordered.
    barrier.open();
    await both;
    const rows = await queryRows(
      engine,
      `SELECT COUNT(*) AS cnt FROM "df_case_lock"`,
    );
    expect(Number(rows[0]?.cnt)).toBe(3);
  });

  it("aborts a buffered registration in flight, not just before it starts", async () => {
    // registerArrowTable takes a caller signal like every other operation. A
    // large buffer spends nearly all of its time inside the appender loop, so
    // checking the signal only on entry would leave a cancelled caller waiting
    // out the whole ingest and would leave the table registered afterwards.
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    const rows = 400_000;
    const arrow = tableToIPC(
      new Table({
        v: vectorFromArray(
          Array.from({ length: rows }, (_, i) => i),
          new Float64(),
        ),
      }),
    );
    const controller = new AbortController();
    const registration = engine.registerArrowTable(
      "df_aborted",
      arrow,
      controller.signal,
    );
    // Abort synchronously after the call returns: the entry check has already
    // run and passed, so only a signal that reached the operation itself can
    // stop this. A timer could not do it — the appender loop is synchronous
    // and would starve the timer until the ingest had already finished.
    controller.abort();
    await expect(registration).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.hasTable("df_aborted")).toBe(false);
  });

  it("observes a timer-driven abort during a buffered ingest, not only before it", async () => {
    // The realistic abort is a request timeout or a dropped socket, which fire
    // from the event loop. A synchronous appender loop starves them, so the
    // ingest has to yield for the abort to exist at all — checking `aborted`
    // without yielding could only ever see one raised before the loop started.
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    const arrow = tableToIPC(
      new Table({
        v: vectorFromArray(
          Array.from({ length: 400_000 }, (_, i) => i),
          new Float64(),
        ),
      }),
    );
    // Calibrate against this machine rather than a fixed millisecond budget:
    // an uninterrupted ingest of the same buffer is the baseline, and an abort
    // fired early in the loop has to land in a fraction of it. Without the
    // yield the rejection still happens — at the post-loop check, after paying
    // for the whole ingest — so only the elapsed time can tell the two apart.
    const baselineStart = performance.now();
    await engine.registerArrowTable("df_baseline", arrow);
    const baseline = performance.now() - baselineStart;

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 2);
    const abortedStart = performance.now();
    await expect(
      engine.registerArrowTable("df_timed_out", arrow, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(performance.now() - abortedStart).toBeLessThan(baseline / 2);
    expect(engine.hasTable("df_timed_out")).toBe(false);
  });

  it("tracks registered tables the way DuckDB identifies them, not by spelling", async () => {
    // One catalog table must be one registry entry. If the registry keyed on
    // the raw spelling, registering "df_CaseName" and then "df_casename" would
    // list two tables for DuckDB's one, and dropping either would leave the
    // other claiming a table that no longer exists.
    engine = new NativeDuckDBEngine();
    const arrow = tableToIPC(
      new Table({ v: vectorFromArray([1, 2, 3], new Int32()) }),
    );
    await engine.registerArrowTable("df_CaseName", arrow);
    expect(engine.hasTable("df_casename")).toBe(true);

    await engine.registerArrowTable("df_casename", arrow);
    expect(engine.getTableNames()).toEqual(["df_casename"]);

    await engine.unregisterTable("DF_CASENAME");
    expect(engine.hasTable("df_CaseName")).toBe(false);
    expect(engine.getTableNames()).toEqual([]);
    // The registry and the catalog agree: the table is really gone.
    await expect(
      engine.queryArrow('SELECT * FROM "df_CaseName"'),
    ).rejects.toThrow();
  });

  it("keeps names DuckDB keeps apart apart, folding only ASCII case", async () => {
    // DuckDB's identifier folding is ASCII-only: "A"/"a" are one table, but
    // "Ä"/"ä" are two (probed on @duckdb/node-api 1.5.3-r.3). A full Unicode
    // fold would merge them in the registry while the catalog kept both, so
    // dropping one would strand the other until teardown.
    engine = new NativeDuckDBEngine();
    const arrow = tableToIPC(
      new Table({ v: vectorFromArray([1, 2, 3], new Int32()) }),
    );
    await engine.registerArrowTable("Ä", arrow);
    await engine.registerArrowTable("ä", arrow);
    expect(engine.getTableNames().sort()).toEqual(["ä", "Ä"].sort());

    await engine.unregisterTable("Ä");
    expect(engine.hasTable("ä")).toBe(true);
    expect(engine.hasTable("Ä")).toBe(false);
    // The survivor is still in the catalog, and unregistering it still works.
    expect(
      (await queryRows(engine, 'SELECT COUNT(*) AS cnt FROM "ä"'))[0]?.cnt,
    ).toBe(3);
    await engine.unregisterTable("ä");
    expect(engine.getTableNames()).toEqual([]);
  });

  it("stays fully usable after a failed appender, with no connection to recover", async () => {
    // The appender-taint recovery is gone, not replaced: a failed appender's
    // connection is discarded with the operation that opened it, and every
    // later operation opens a clean one. Nothing shared was ever touched, so
    // reads, buffered registrations and streamed registrations all keep
    // working with no recovery step in between.
    engine = new NativeDuckDBEngine();
    await engine.registerArrowTable(
      "df_survivor",
      tableToIPC(new Table({ n: vectorFromArray([1, 2, 3], new Float64()) })),
    );

    const OVER_INT64 = 9223372036854775808n; // 2^63 — exceeds DuckDB BIGINT
    await expect(
      engine.registerArrowTable(
        "df_survivor",
        tableToIPC(
          new Table({ n: vectorFromArray([1n, OVER_INT64], new Uint64()) }),
        ),
      ),
    ).rejects.toThrow("bigint out of int64 range");

    expect(engine.isReady()).toBe(true);
    // The live table is untouched by the failed replacement of its own name.
    expect(
      Number(
        (
          await queryRows(engine, 'SELECT COUNT(*) AS cnt FROM "df_survivor"')
        )[0]?.cnt,
      ),
    ).toBe(3);
    expect(
      tableFromIPC(await engine.queryArrow("SELECT 1 AS alive"))
        .getChild("alive")
        ?.get(0),
    ).toBe(1);
    await engine.registerArrowStream(
      "df_after_failed_appender",
      (async function* () {
        yield tableToIPC(
          new Table({ v: vectorFromArray([9], new Int32()) }),
          "stream",
        );
      })(),
    );
    expect(engine.hasTable("df_after_failed_appender")).toBe(true);
    await engine.unregisterTable("df_survivor");
    expect(engine.hasTable("df_survivor")).toBe(false);
  });

  it("locks access restrictions on the instance, so a fresh connection cannot lift them", async () => {
    // The restriction is applied at initialize() on a connection that is
    // closed again immediately. Every operation below runs on a connection
    // opened afterwards: if the settings were connection-scoped rather than
    // instance-scoped, client SQL could simply turn them back on and the whole
    // connection-per-operation model would hand every chart query a way out.
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    await expect(
      engine.queryArrow("SET enable_external_access=true"),
    ).rejects.toThrow(/locked/);
    await expect(
      engine.queryArrow("SET lock_configuration=false"),
    ).rejects.toThrow(/locked/);
    const setting = await queryRows(
      engine,
      "SELECT current_setting('enable_external_access') AS enabled",
    );
    expect(setting[0]?.enabled).toBe(false);
  });

  describe("registerArrowTable — in-memory Arrow ingest", () => {
    /**
     * Build an Arrow IPC buffer the same way the renderer's producer does
     * (engine-browser createArrowIPCBufferFromRows): Float64 / Bool /
     * TimestampMillisecond / Utf8 columns.
     */
    function producerBuffer(): Uint8Array {
      const ts = Date.UTC(2026, 0, 15, 12, 30, 0); // 2026-01-15T12:30:00Z
      return tableToIPC(
        new Table({
          amount: vectorFromArray([10.5, null, 33.25], new Float64()),
          active: vectorFromArray([true, false, null], new Bool()),
          created: vectorFromArray(
            [ts, null, ts + MS_PER_HOUR],
            new TimestampMillisecond(),
          ),
          label: vectorFromArray(["a", "b", null], new Utf8()),
        }),
      );
    }

    it("registers a table that is queryable with exact values and nulls", async () => {
      engine = new NativeDuckDBEngine();
      await engine.registerArrowTable("df_test", producerBuffer());

      const result = await queryRows(
        engine,
        'SELECT amount, active, label FROM "df_test" ORDER BY amount NULLS LAST',
      );
      expect(result.length).toBe(3);
      expect(result[0]).toMatchObject({
        amount: 10.5,
        active: true,
        label: "a",
      });
      expect(result[1]).toMatchObject({ amount: 33.25, label: null });
      expect(result[2]).toMatchObject({ amount: null, label: "b" });
    });

    it("preserves timestamps as native TIMESTAMP, not strings (type fidelity)", async () => {
      engine = new NativeDuckDBEngine();
      await engine.registerArrowTable("df_ts", producerBuffer());

      // typeof() proves the column landed as TIMESTAMP — a JSON round-trip
      // would have degraded it to VARCHAR. epoch_ms proves value fidelity.
      const result = await queryRows(
        engine,
        `SELECT typeof(created) AS t, epoch_ms(created) AS ms
         FROM "df_ts" WHERE created IS NOT NULL ORDER BY created`,
      );
      expect(result.map((r) => r.t)).toEqual(["TIMESTAMP", "TIMESTAMP"]);
      const ts = Date.UTC(2026, 0, 15, 12, 30, 0);
      expect(result.map((r) => Number(r.ms))).toEqual([ts, ts + MS_PER_HOUR]);
    });

    it("never writes row data to the filesystem (privacy floor)", async () => {
      // The old implementation staged rows as an NDJSON temp file. The privacy
      // floor forbids row data at rest outside the gated cache — pin the
      // in-memory contract by checking no staging file appears in tmpdir.
      engine = new NativeDuckDBEngine();
      await engine.registerArrowTable("df_privacy_probe", producerBuffer());

      const tmpEntries = await fs.readdir(os.tmpdir());
      expect(tmpEntries.filter((f) => f.includes("df_privacy_probe"))).toEqual(
        [],
      );
    });

    it("tracks registered tables and unregisters cleanly", async () => {
      engine = new NativeDuckDBEngine();
      await engine.registerArrowTable("df_tracked", producerBuffer());
      expect(engine.hasTable("df_tracked")).toBe(true);
      expect(engine.getTableNames()).toContain("df_tracked");

      await engine.unregisterTable("df_tracked");
      expect(engine.hasTable("df_tracked")).toBe(false);
      await expect(
        engine.queryArrow('SELECT * FROM "df_tracked"'),
      ).rejects.toThrow();
    });

    it("keeps a registration retryable when native DROP fails transiently", async () => {
      engine = new NativeDuckDBEngine();
      await engine.registerArrowTable("df_retry_drop", producerBuffer());
      // Fail the DROP on the connection the unregister opens for itself.
      const internals = engine as unknown as {
        instance: {
          connect(): Promise<{ run(sql: string): Promise<unknown> }>;
        };
      };
      const rawInstance = internals.instance;
      let failNextRun = true;
      internals.instance = new Proxy(rawInstance, {
        get(target, prop, receiver) {
          if (prop !== "connect") return Reflect.get(target, prop, receiver);
          return async () => {
            const conn = await target.connect();
            const run = conn.run.bind(conn);
            conn.run = (sql: string) => {
              if (!failNextRun) return run(sql);
              failNextRun = false;
              return Promise.reject(new Error("transient native DROP failure"));
            };
            return conn;
          };
        },
      });

      await expect(engine.unregisterTable("df_retry_drop")).rejects.toThrow(
        "transient native DROP failure",
      );
      internals.instance = rawInstance;
      expect(engine.hasTable("df_retry_drop")).toBe(true);
      expect(
        Number(
          (
            await queryRows(engine, 'SELECT COUNT(*) AS n FROM "df_retry_drop"')
          )[0]?.n,
        ),
      ).toBe(3);

      await engine.unregisterTable("df_retry_drop");
      expect(engine.hasTable("df_retry_drop")).toBe(false);
      await expect(
        engine.queryArrow('SELECT * FROM "df_retry_drop"'),
      ).rejects.toThrow();
    });

    it("serializes unregister behind an in-flight registration", async () => {
      engine = new NativeDuckDBEngine();
      await engine.initialize();
      const registering = engine.registerArrowTable(
        "df_race",
        producerBuffer(),
      );
      const unregistering = engine.unregisterTable("df_race");
      await Promise.all([registering, unregistering]);
      expect(engine.hasTable("df_race")).toBe(false);
      await expect(
        engine.queryArrow('SELECT * FROM "df_race"'),
      ).rejects.toThrow();
    });

    it("atomic ingest — a failed append leaves the prior table intact (no partial replace)", async () => {
      // Contract: if registerArrowTable throws mid-append (e.g. type mismatch),
      // the previously registered table must be unchanged and still queryable.
      // The staging-table swap ensures this; the old NDJSON path did NOT.
      engine = new NativeDuckDBEngine();

      // Register the initial table with known data.
      await engine.registerArrowTable("df_atomic", producerBuffer());

      // Confirm the initial data is there (3 rows).
      const before = await queryRows(
        engine,
        'SELECT COUNT(*) AS cnt FROM "df_atomic"',
      );
      expect(Number(before[0]?.cnt)).toBe(3);

      // Attempt a second registration with corrupted (non-Arrow) bytes.
      // This should throw during staging-table creation or append.
      await expect(
        engine.registerArrowTable(
          "df_atomic",
          new Uint8Array([0xff, 0xfe, 0x00, 0x01]), // not valid Arrow IPC
        ),
      ).rejects.toThrow();

      // The live table must still have the original 3 rows — not 0 or partial.
      const after = await queryRows(
        engine,
        'SELECT COUNT(*) AS cnt FROM "df_atomic"',
      );
      expect(Number(after[0]?.cnt)).toBe(3);
    });

    it("preserves date-only (Date32/DateDay) columns without shifting to epoch", async () => {
      // Regression for the Arrow date value-translation class: a Date32/DateDay
      // column must round-trip to the same calendar date, not collapse to day 0
      // or shift. The conversion divides the `.get()` result by MS_PER_DAY;
      // apache-arrow normalizes Date32 to epoch millis, so the stored DuckDB
      // DATE must equal the original calendar day.
      engine = new NativeDuckDBEngine();
      const day1 = Date.UTC(2021, 0, 2); // 2021-01-02
      const day2 = Date.UTC(1999, 11, 31); // 1999-12-31
      const buffer = tableToIPC(
        new Table({
          d: vectorFromArray([day1, null, day2], new DateDay()),
        }),
      );
      await engine.registerArrowTable("df_date32", buffer);

      const result = await queryRows(
        engine,
        `SELECT typeof(d) AS t, strftime(d, '%Y-%m-%d') AS iso
         FROM "df_date32" WHERE d IS NOT NULL ORDER BY d`,
      );
      expect(result.map((r) => r.t)).toEqual(["DATE", "DATE"]);
      expect(result.map((r) => r.iso)).toEqual(["1999-12-31", "2021-01-02"]);
    });

    it("preserves Date64 (DateMillisecond) columns to the correct calendar day", async () => {
      engine = new NativeDuckDBEngine();
      const day = Date.UTC(2024, 5, 13); // 2024-06-13
      const buffer = tableToIPC(
        new Table({
          d: vectorFromArray([day], new DateMillisecond()),
        }),
      );
      await engine.registerArrowTable("df_date64", buffer);

      const result = await queryRows(
        engine,
        `SELECT strftime(d, '%Y-%m-%d') AS iso FROM "df_date64"`,
      );
      expect(result[0]?.iso).toBe("2024-06-13");
    });

    it("does not corrupt concurrent registrations of the same table name", async () => {
      // Two in-flight registrations of the same live table must not corrupt
      // each other. That name's lock serializes them; the live table ends with
      // one upload's complete rows (last-writer-wins), never a mix or a thrown
      // error.
      //
      // What punishes a lost same-name lock is DuckDB's catalog write-write
      // conflict: two connections both running `CREATE OR REPLACE TABLE live`
      // abort one side, on every platform (20/20 rounds when probed). So this
      // test discriminates the LOSS of same-name serialization everywhere,
      // locally included — it is not a macOS smoke screen. (It does not
      // discriminate the lock's SHAPE: the old global lock also passes.)
      // Historical: before one connection per operation, the mechanism was the
      // Linux-only NAPI pending-result taint on the shared connection.
      engine = new NativeDuckDBEngine();

      const bufferA = tableToIPC(
        new Table({
          v: vectorFromArray([1, 2, 3, 4, 5], new Int32()),
        }),
      );
      const bufferB = tableToIPC(
        new Table({
          v: vectorFromArray([10, 20, 30, 40, 50, 60, 70], new Int32()),
        }),
      );

      // Fire both at once against the same target name.
      await Promise.all([
        engine.registerArrowTable("df_concurrent", bufferA),
        engine.registerArrowTable("df_concurrent", bufferB),
      ]);

      // The table must hold exactly one upload's rows (5 or 7), never a mix.
      const result = await queryRows(
        engine,
        'SELECT COUNT(*) AS cnt FROM "df_concurrent"',
      );
      const cnt = Number(result[0]?.cnt);
      expect([5, 7]).toContain(cnt);

      // No leaked staging tables remain after the swaps. Staging tables are TEMP
      // and connection-local, so this query — on its own fresh connection —
      // could not see one even if it leaked; what it still pins is that the
      // swap does not leave a NON-temp table behind under a staging name.
      const staging = await queryRows(
        engine,
        `SELECT COUNT(*) AS cnt FROM duckdb_tables()
         WHERE table_name LIKE '__staging_df_concurrent%'`,
      );
      expect(Number(staging[0]?.cnt)).toBe(0);
    });

    it("handles high-concurrency registrations without corruption or error", async () => {
      // Stress variant: 8 concurrent uploads across 4 distinct table names
      // (2 per name) — four lock queues two deep, running against each other.
      // Contract: each named table ends with one upload's complete row count;
      // no thrown errors; no leaked staging tables.
      //
      // Like the 2-way variant above, dropping same-name serialization surfaces
      // as a catalog write-write conflict on every platform, so this run is
      // discriminating rather than a smoke screen.
      engine = new NativeDuckDBEngine();

      const uploads: Array<{ name: string; expectedCounts: number[] }> = [
        { name: "df_stress_a", expectedCounts: [10, 20] },
        { name: "df_stress_b", expectedCounts: [15, 25] },
        { name: "df_stress_c", expectedCounts: [12, 30] },
        { name: "df_stress_d", expectedCounts: [8, 40] },
      ];

      const tasks = uploads.flatMap(({ name, expectedCounts }) => {
        const [countA, countB] = expectedCounts;
        const bufA = tableToIPC(
          new Table({
            v: vectorFromArray(
              Array.from({ length: countA! }, (_, i) => i),
              new Int32(),
            ),
          }),
        );
        const bufB = tableToIPC(
          new Table({
            v: vectorFromArray(
              Array.from({ length: countB! }, (_, i) => i + 100),
              new Int32(),
            ),
          }),
        );
        return [
          engine!.registerArrowTable(name, bufA),
          engine!.registerArrowTable(name, bufB),
        ];
      });

      // If any registration rejects, Promise.all rejects and the test fails.
      await Promise.all(tasks);

      for (const { name, expectedCounts } of uploads) {
        const result = await queryRows(
          engine!,
          `SELECT COUNT(*) AS cnt FROM "${name}"`,
        );
        expect(expectedCounts).toContain(Number(result[0]?.cnt));
      }

      // No staging tables should survive. Same caveat as the 2-way variant:
      // this fresh connection cannot see another connection's TEMP tables, so
      // it pins the absence of a non-temp leftover.
      const leaked = await queryRows(
        engine!,
        `SELECT COUNT(*) AS cnt FROM duckdb_tables()
         WHERE table_name LIKE '__staging_%'`,
      );
      expect(Number(leaked[0]?.cnt)).toBe(0);
    });
  });
});

// ─── The DuckDB property the connection-per-operation design rests on ────────
//
// On Linux, duckdb_appender_close() on a failed appender marks the connection
// with a pending-result error. The next duckdb_query() on the same connection
// then fails with "Attempting to execute an unsuccessful or closed pending
// query result" — emitted as an unhandled NAPI-layer rejection that bypasses
// the surrounding JS try/catch.
//
// The engine no longer has a shared connection for that taint to spread
// through: a failed appender's connection is closed with the operation that
// opened it, and the next operation opens its own. This test pins the DuckDB
// property that makes discarding sufficient rather than merely convenient —
// that a fresh connection from the SAME instance is clean after a tainted
// close, and that the closed connection's TEMP tables (the partial staging
// copy) go with it. Both are load-bearing: without them, discarding the
// connection would leave either a poisoned instance or a leaked staging table.
//
// It sits at the DuckDBInstance layer, independent of the engine contract
// tests above. The Linux-specific taint cannot be reproduced on macOS
// (conn.run() succeeds after appender error there), so this acts as a smoke
// screen locally; Linux CI is the discriminating run.
describe("DuckDB instance semantics — a fresh connection after a tainted appender", () => {
  it("a fresh connection from the same instance works after a tainted appender closeSync", async () => {
    // Force appender into error state → closeSync → disconnect the tainted
    // conn → connect again from the same instance → the new conn is clean.
    // The TEMP staging table (connection-local) must be gone after disconnect.
    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();

    let freshConn;
    try {
      await conn.run(
        "CREATE TEMP TABLE __staging_reset_test (x INTEGER, y INTEGER)",
      );

      // Force the appender into error state: flush an incomplete row
      // (1 value appended, 2 columns required → "incomplete append to row").
      // Precondition: flushSync must throw — this is what triggers the taint.
      const appender = await conn.createAppender("__staging_reset_test");
      appender.appendInteger(42); // only 1 of 2 required columns
      expect(() => appender.flushSync()).toThrow(); // precondition: must throw
      try {
        appender.closeSync();
      } catch {
        /* close may also throw in error state — ignored */
      }

      // Discard the tainted connection — what a lease's release() does for
      // the operation that failed.
      conn.disconnectSync();

      // A fresh connection from the same instance must be clean and functional.
      freshConn = await instance.connect();

      // The staging TEMP table was connection-local to `conn` — it is gone now.
      // Query duckdb_tables() to confirm: zero rows matching the staging name.
      const reader = await freshConn.runAndReadAll(
        "SELECT count(*) AS cnt FROM duckdb_tables() WHERE table_name = '__staging_reset_test'",
      );
      const rows = reader.getRowObjectsJson() as Array<{ cnt: unknown }>;
      expect(Number(rows[0]?.cnt)).toBe(0);

      // The fresh connection can execute arbitrary queries without error.
      const reader2 = await freshConn.runAndReadAll("SELECT 1 AS alive");
      const rows2 = reader2.getRowObjectsJson() as Array<{ alive: unknown }>;
      expect(Number(rows2[0]?.alive)).toBe(1);
    } finally {
      freshConn?.disconnectSync();
      instance.closeSync();
    }
  });
});

// ─── Engine reuse regression: query succeeds after registerArrowTable fails ───
//
// The taint is Linux-only; macOS conn.run() succeeds even after appender error.
// This test verifies the ENGINE-LEVEL contract: registerArrowTable failure must
// not leave the engine in a state where subsequent operations throw. On macOS
// this passes regardless of the connection model (no taint), so the local run is
// a smoke test; Linux CI is the discriminating run. The test documents the
// CONTRACT even if it cannot reproduce the exact failure mode here.
describe("NativeDuckDBEngine — reuse after registerArrowTable failure", () => {
  let engine: NativeDuckDBEngine | null = null;

  afterEach(async () => {
    await engine?.dispose();
    engine = null;
  });

  it("engine remains usable for queryArrow() and registerArrowTable() after a failed ingest", async () => {
    // Scenario: registerArrowTable fails INSIDE the append loop (valid Arrow
    // buffer decodes without error, but appending a Uint64 value that exceeds
    // DuckDB's signed BIGINT range throws "bigint out of int64 range" synchronously
    // inside appendArrowValue — after the appender is created and the connection
    // is potentially tainted on Linux).
    //
    // Arrow `Uint64` maps to typeId `ArrowType.Int` (isSigned=false, bitWidth=64).
    // `arrowFieldToDuckDBType` maps it to `BIGINT` (signed int64), and
    // `appendArrowValue` calls `appendBigInt(value)` since `.get()` returns a
    // BigInt. A value of 2^63 (= 9223372036854775808n) exceeds int64 max and
    // throws at the native DuckDB layer — inside the try block, after the
    // appender is open.
    //
    // On macOS this path does NOT taint the connection (macOS-specific DuckDB
    // behavior), so the test passes regardless of the connection model there. On
    // Linux the connection IS tainted by the failed appendBigInt; on a shared
    // connection the subsequent queryArrow() would hit the "pending-result"
    // unhandled rejection. It cannot now: that connection is already closed.
    // Linux CI is the discriminating run; this test documents the contract and
    // verifies the catch-block failure path is actually reached.
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    // Register a good table first so we can verify it survives the failure.
    const goodInitBuf = tableToIPC(
      new Table({ n: vectorFromArray([1.0, 2.0, 3.0], new Float64()) }),
    );
    await engine.registerArrowTable("df_before", goodInitBuf);
    const before = await queryRows(
      engine,
      'SELECT COUNT(*) AS cnt FROM "df_before"',
    );
    expect(Number(before[0]?.cnt)).toBe(3); // precondition

    // Trigger a failure INSIDE the append loop (inside the try block, after the
    // appender is created). 2^63 is a valid Uint64 value in Arrow but exceeds
    // DuckDB BIGINT max (2^63 - 1), so appendBigInt throws.
    const OVER_INT64 = 9223372036854775808n; // 2^63 = INT64_MAX + 1
    const overflowBuf = tableToIPC(
      new Table({
        n: vectorFromArray([1n, OVER_INT64, 3n], new Uint64()),
      }),
    );
    await expect(
      engine.registerArrowTable("df_overflow", overflowBuf),
    ).rejects.toThrow("bigint out of int64 range"); // precondition: catch block exercised

    // The engine must still be operational after the failure. On Linux, on a
    // shared connection, this would throw "executing an unsuccessful or closed
    // pending query result" as an unhandled NAPI rejection.
    const after = await queryRows(
      engine,
      'SELECT COUNT(*) AS cnt FROM "df_before"',
    );
    expect(Number(after[0]?.cnt)).toBe(3); // pre-existing table intact

    // registerArrowTable with valid data must succeed on the SAME engine instance.
    const goodBuf = tableToIPC(
      new Table({ n: vectorFromArray([1.0], new Float64()) }),
    );
    await expect(
      engine.registerArrowTable("df_after_failure", goodBuf),
    ).resolves.toBeUndefined();

    const afterReg = await queryRows(
      engine,
      'SELECT COUNT(*) AS cnt FROM "df_after_failure"',
    );
    expect(Number(afterReg[0]?.cnt)).toBe(1);
  });
});
