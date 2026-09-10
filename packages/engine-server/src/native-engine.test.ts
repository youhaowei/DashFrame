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

import { NativeDuckDBEngine } from "./native-engine";

const MS_PER_HOUR = 3_600_000;

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

    const result = await engine.query(
      "SELECT range AS n FROM range(3) ORDER BY n",
    );
    expect(result.rowCount).toBe(3);
    expect(result.columns.map((c) => c.name)).toEqual(["n"]);
    expect(result.rows.map((r) => Number(r.n))).toEqual([0, 1, 2]);
  });

  it("query() returns normalized column types, not raw DuckDB type ids", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    // Same normalization the Arrow path (queryArrow → arrow-encode) applies:
    // semantic ColumnType names, never numeric DuckDB type-id strings. A caller
    // branching on column.type must see "number"/"string", not "4"/"17".
    const result = await engine.query(
      "SELECT 1::int AS i, 'a' AS s, 1.5::double AS d",
    );
    expect(result.columns).toEqual([
      { name: "i", type: "number" },
      { name: "s", type: "string" },
      { name: "d", type: "number" },
    ]);
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

    const result = await engine.query(
      "SELECT count(*) AS n, max(value) AS tail, sum(value) AS total FROM df_streamed",
    );
    expect(result.rows[0]).toMatchObject({
      n: "25001",
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
      (await engine.query("SELECT value FROM df_atomic_stream")).rows,
    ).toEqual([{ value: 7 }]);
  });

  it("is not usable after dispose()", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    expect(engine.isReady()).toBe(true);

    await engine.dispose();

    // isReady() must return false — the connection reference is gone.
    expect(engine.isReady()).toBe(false);
    // query() must throw rather than silently return empty results, so callers
    // discover the misuse instead of seeing a ghost success.
    await expect(engine.query("SELECT 1")).rejects.toThrow(
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

    // Must reject promptly rather than queue behind the registration lock.
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

    // query()/queryArrow() use persistent leases. During teardown, their joined
    // lifecycle signal must reject them before either starts a new statement on
    // the connection that dispose() is draining and about to disconnect.
    await expect(engine.queryArrow("SELECT 1")).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(engine.query("SELECT 1")).rejects.toMatchObject({
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
        .query(
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
    await expect(engine.query("SELECT 1")).rejects.toThrow(
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

  it("is idempotent under concurrent initialize() — one connection, no leaked instance", async () => {
    engine = new NativeDuckDBEngine();
    // Two callers race before the first await resolves; both must converge on
    // the same connection rather than each creating a DuckDBInstance.
    await Promise.all([engine.initialize(), engine.initialize()]);
    expect(engine.isReady()).toBe(true);

    // A query still works on the single surviving connection.
    const result = await engine.query("SELECT 1 AS one");
    expect(result.rows.map((r) => Number(r.one))).toEqual([1]);
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

  it("a dedicated connection that fails to disconnect still hands back the lock and refcount", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    const internals = engine as unknown as {
      instance: { connect(): Promise<{ disconnectSync(): void }> };
    };
    const rawInstance = internals.instance;
    // Make the NEXT dedicated connection's disconnectSync() throw on release.
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

  it("dispose() completes and closes the instance even when the connection refuses to disconnect", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    const internals = engine as unknown as {
      connection: { disconnectSync(): void };
      instance: { closeSync(): void } | null;
    };
    vi.spyOn(internals.connection, "disconnectSync").mockImplementation(() => {
      throw new Error("disconnect failed");
    });
    const closeSync = vi.spyOn(internals.instance!, "closeSync");

    await expect(engine.dispose()).resolves.toBeUndefined();
    expect(closeSync).toHaveBeenCalledTimes(1);
    expect(engine.isReady()).toBe(false);
    await expect(engine.dispose()).resolves.toBeUndefined();
    await expect(engine.initialize()).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("queues a registration behind a connection swap instead of rejecting it", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    // Reproduce the window replaceTaintedConnection() opens: the registration
    // lock is held and the persistent handle is null until the reconnect
    // resolves. A registration arriving now must wait for the lock and use
    // the replacement, not fail with "not initialized".
    const internals = engine as unknown as {
      connection: unknown;
      acquireRegistrationLock(): Promise<() => void>;
    };
    const unlock = await internals.acquireRegistrationLock();
    const liveConnection = internals.connection;
    internals.connection = null;

    const arrow = tableToIPC(
      new Table({ v: vectorFromArray([1, 2, 3], new Int32()) }),
      "stream",
    );
    const queued = engine.registerArrowTable("df_after_swap", arrow);
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    internals.connection = liveConnection;
    unlock();

    await expect(queued).resolves.toBeUndefined();
    expect(engine.hasTable("df_after_swap")).toBe(true);
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
      connection: { runAndReadAll: (...args: unknown[]) => unknown };
    };
    const runAndReadAll = vi.spyOn(internals.connection, "runAndReadAll");

    // Acquisition yields once before the callback runs. A dispose() landing
    // in that microtask has already interrupted a statement that does not
    // exist yet; the query must notice and stop, not run unstoppable through
    // teardown.
    let disposing!: Promise<void>;
    queueMicrotask(() => {
      disposing = engine!.dispose();
    });
    await expect(engine.query("SELECT 1")).rejects.toMatchObject({
      name: "AbortError",
    });
    await disposing;

    expect(runAndReadAll).not.toHaveBeenCalled();
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
    // call an operation makes through the persistent connection, the
    // instance, or a dedicated connection opened from the instance must
    // happen while the engine has an operation enrolled
    // (`activeNativeOperations > 0`) — that enrolment is what makes dispose()
    // wait instead of closing the handle underneath the call. The lifecycle
    // methods are out of scope by construction: openInstance() runs before
    // the proxies are installed and teardown() after they are removed, since
    // both legitimately touch handles with nothing enrolled. The proxies
    // record any native call made unenrolled, so an operation that reaches a
    // handle without going through the lease fails here even though it would
    // "work" on a live engine.
    //
    // Every method on the class must run inside this test, so a new entry
    // point cannot skip the check silently: spies on the prototype fail the
    // test for any method the exercise block below never reached.
    const notNativeTouching = new Set([
      "constructor",
      "isReady",
      "hasTable",
      "getTableNames",
      "registerTable", // unsupported; throws before touching anything
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
      connection: object;
      instance: object;
      activeNativeOperations: number;
    };
    const rawConnection = internals.connection;
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
            // A dedicated connection is born from `instance.connect()`; guard
            // it too so streaming paths are held to the same rule.
            return prop === "connect" && result instanceof Promise
              ? result.then((conn: object) => guarded(conn, "dedicated"))
              : result;
          };
        },
      });
    internals.connection = guarded(rawConnection, "connection");
    internals.instance = guarded(rawInstance, "instance");

    try {
      const arrow = tableToIPC(
        new Table({ v: vectorFromArray([1, 2], new Int32()) }),
        "stream",
      );
      await engine.query("SELECT 1");
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
      // The appender-failure path swaps the persistent connection; it must do
      // so from inside the lease like everything else.
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
      // The swap installed a replacement (opened through the guarded
      // instance, so still proxied); afterEach must disconnect that one, so
      // leave it in place.
      expect(internals.connection).not.toBe(rawConnection);

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

      const result = await engine.query(
        'SELECT amount, active, label FROM "df_test" ORDER BY amount NULLS LAST',
      );
      expect(result.rowCount).toBe(3);
      expect(result.rows[0]).toMatchObject({
        amount: 10.5,
        active: true,
        label: "a",
      });
      expect(result.rows[1]).toMatchObject({ amount: 33.25, label: null });
      expect(result.rows[2]).toMatchObject({ amount: null, label: "b" });
    });

    it("preserves timestamps as native TIMESTAMP, not strings (type fidelity)", async () => {
      engine = new NativeDuckDBEngine();
      await engine.registerArrowTable("df_ts", producerBuffer());

      // typeof() proves the column landed as TIMESTAMP — a JSON round-trip
      // would have degraded it to VARCHAR. epoch_ms proves value fidelity.
      const result = await engine.query(
        `SELECT typeof(created) AS t, epoch_ms(created) AS ms
         FROM "df_ts" WHERE created IS NOT NULL ORDER BY created`,
      );
      expect(result.rows.map((r) => r.t)).toEqual(["TIMESTAMP", "TIMESTAMP"]);
      const ts = Date.UTC(2026, 0, 15, 12, 30, 0);
      expect(result.rows.map((r) => Number(r.ms))).toEqual([
        ts,
        ts + MS_PER_HOUR,
      ]);
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
        engine.query('SELECT * FROM "df_tracked"'),
      ).rejects.toThrow();
    });

    it("keeps a registration retryable when native DROP fails transiently", async () => {
      engine = new NativeDuckDBEngine();
      await engine.registerArrowTable("df_retry_drop", producerBuffer());
      const connection = (
        engine as unknown as {
          connection: { run(sql: string): Promise<unknown> };
        }
      ).connection;
      vi.spyOn(connection, "run").mockRejectedValueOnce(
        new Error("transient native DROP failure"),
      );

      await expect(engine.unregisterTable("df_retry_drop")).rejects.toThrow(
        "transient native DROP failure",
      );
      expect(engine.hasTable("df_retry_drop")).toBe(true);
      expect(
        Number(
          (await engine.query('SELECT COUNT(*) AS n FROM "df_retry_drop"'))
            .rows[0]?.n,
        ),
      ).toBe(3);

      await engine.unregisterTable("df_retry_drop");
      expect(engine.hasTable("df_retry_drop")).toBe(false);
      await expect(
        engine.query('SELECT * FROM "df_retry_drop"'),
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
      await expect(engine.query('SELECT * FROM "df_race"')).rejects.toThrow();
    });

    it("atomic ingest — a failed append leaves the prior table intact (no partial replace)", async () => {
      // Contract: if registerArrowTable throws mid-append (e.g. type mismatch),
      // the previously registered table must be unchanged and still queryable.
      // The staging-table swap ensures this; the old NDJSON path did NOT.
      engine = new NativeDuckDBEngine();

      // Register the initial table with known data.
      await engine.registerArrowTable("df_atomic", producerBuffer());

      // Confirm the initial data is there (3 rows).
      const before = await engine.query(
        'SELECT COUNT(*) AS cnt FROM "df_atomic"',
      );
      expect(Number(before.rows[0]?.cnt)).toBe(3);

      // Attempt a second registration with corrupted (non-Arrow) bytes.
      // This should throw during staging-table creation or append.
      await expect(
        engine.registerArrowTable(
          "df_atomic",
          new Uint8Array([0xff, 0xfe, 0x00, 0x01]), // not valid Arrow IPC
        ),
      ).rejects.toThrow();

      // The live table must still have the original 3 rows — not 0 or partial.
      const after = await engine.query(
        'SELECT COUNT(*) AS cnt FROM "df_atomic"',
      );
      expect(Number(after.rows[0]?.cnt)).toBe(3);
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

      const result = await engine.query(
        `SELECT typeof(d) AS t, strftime(d, '%Y-%m-%d') AS iso
         FROM "df_date32" WHERE d IS NOT NULL ORDER BY d`,
      );
      expect(result.rows.map((r) => r.t)).toEqual(["DATE", "DATE"]);
      expect(result.rows.map((r) => r.iso)).toEqual([
        "1999-12-31",
        "2021-01-02",
      ]);
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

      const result = await engine.query(
        `SELECT strftime(d, '%Y-%m-%d') AS iso FROM "df_date64"`,
      );
      expect(result.rows[0]?.iso).toBe("2024-06-13");
    });

    it("does not corrupt concurrent registrations of the same table name", async () => {
      // Two in-flight registrations of the same live table must not corrupt
      // each other. The global registration lock serializes them; the live table
      // ends with one upload's complete rows (last-writer-wins), never a mix or
      // a thrown error.
      //
      // The NAPI pending-result taint (the corruption mechanism) is Linux-only;
      // this test passes on macOS regardless of the fix. It documents the
      // contract and fires on Linux CI as the discriminating run. A higher-
      // concurrency stress variant below maximises interleaving on both platforms.
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
      const result = await engine.query(
        'SELECT COUNT(*) AS cnt FROM "df_concurrent"',
      );
      const cnt = Number(result.rows[0]?.cnt);
      expect([5, 7]).toContain(cnt);

      // No leaked staging tables remain after the swaps.
      const staging = await engine.query(
        `SELECT COUNT(*) AS cnt FROM duckdb_tables()
         WHERE table_name LIKE '__staging_df_concurrent%'`,
      );
      expect(Number(staging.rows[0]?.cnt)).toBe(0);
    });

    it("handles high-concurrency registrations without corruption or error", async () => {
      // Stress variant: 8 concurrent uploads across 4 distinct table names
      // (2 per name) maximise lock-queue depth and appender interleaving.
      // Contract: each named table ends with one upload's complete row count;
      // no thrown errors; no leaked staging tables.
      //
      // Like the 2-way variant above, the NAPI taint is Linux-only; the
      // structural argument (global serialization lock) is the durable proof.
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
        const result = await engine!.query(
          `SELECT COUNT(*) AS cnt FROM "${name}"`,
        );
        expect(expectedCounts).toContain(Number(result.rows[0]?.cnt));
      }

      // No staging tables should survive.
      const leaked = await engine!.query(
        `SELECT COUNT(*) AS cnt FROM duckdb_tables()
         WHERE table_name LIKE '__staging_%'`,
      );
      expect(Number(leaked.rows[0]?.cnt)).toBe(0);
    });
  });
});

// ─── Connection-reset mechanism: disconnect + reconnect after appender error ──
//
// On Linux, duckdb_appender_close() on a failed appender marks the connection
// with a pending-result error. The next duckdb_query() on the same connection
// then fails with "Attempting to execute an unsuccessful or closed pending
// query result" — emitted as an unhandled NAPI-layer rejection that bypasses
// the surrounding JS try/catch.
//
// this.connection is the PERSISTENT connection reused for the whole session
// (query, queryArrow, every registerArrowTable call). A simple "issue cleanup
// on a fresh connection" approach leaves this.connection tainted, relocating
// the flake to the NEXT operation. The fix disconnects this.connection and
// reconnects from the same DuckDBInstance — preserving all non-TEMP tables
// (instance-scoped) while discarding the tainted connection state. The partial
// staging TEMP table (connection-local) is dropped automatically by DuckDB
// when the old connection closes.
//
// These tests pin the mechanism at the DuckDBInstance layer, independent of
// the registerArrowTable contract tests above. The Linux-specific taint cannot
// be reproduced on macOS (conn.run() succeeds after appender error there), so
// these tests act as a smoke screen locally; Linux CI is the discriminating run.
describe("DuckDB connection-reset mechanism — appender-error recovery", () => {
  it("a fresh connection from the same instance works after a tainted appender closeSync", async () => {
    // Reproduce: force appender into error state → closeSync → disconnect the
    // tainted conn → reconnect from same instance → new conn is clean.
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

      // Disconnect the tainted connection (mirrors the fix in registerArrowTable).
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
// this passes regardless of fix (no taint), so the local run is a smoke test;
// Linux CI is the discriminating run. The test documents the CONTRACT even if
// it cannot reproduce the exact failure mode here.
describe("NativeDuckDBEngine — reuse after registerArrowTable failure", () => {
  let engine: NativeDuckDBEngine | null = null;

  afterEach(async () => {
    await engine?.dispose();
    engine = null;
  });

  it("engine remains usable for query() and registerArrowTable() after a failed ingest", async () => {
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
    // behavior), so the test passes regardless of the fix there. On Linux the
    // connection IS tainted by the failed appendBigInt; without the fix the
    // subsequent query() would hit the "pending-result" unhandled rejection.
    // Linux CI is the discriminating run; this test documents the contract and
    // verifies the catch-block failure path is actually reached.
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    // Register a good table first so we can verify it survives the failure.
    const goodInitBuf = tableToIPC(
      new Table({ n: vectorFromArray([1.0, 2.0, 3.0], new Float64()) }),
    );
    await engine.registerArrowTable("df_before", goodInitBuf);
    const before = await engine.query(
      'SELECT COUNT(*) AS cnt FROM "df_before"',
    );
    expect(Number(before.rows[0]?.cnt)).toBe(3); // precondition

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

    // The engine must still be operational after the failure.
    // On Linux without the fix this would throw "executing an unsuccessful or
    // closed pending query result" as an unhandled NAPI rejection.
    const after = await engine.query('SELECT COUNT(*) AS cnt FROM "df_before"');
    expect(Number(after.rows[0]?.cnt)).toBe(3); // pre-existing table intact

    // registerArrowTable with valid data must succeed on the SAME engine instance.
    const goodBuf = tableToIPC(
      new Table({ n: vectorFromArray([1.0], new Float64()) }),
    );
    await expect(
      engine.registerArrowTable("df_after_failure", goodBuf),
    ).resolves.toBeUndefined();

    const afterReg = await engine.query(
      'SELECT COUNT(*) AS cnt FROM "df_after_failure"',
    );
    expect(Number(afterReg.rows[0]?.cnt)).toBe(1);
  });
});
