import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import {
  Bool,
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

describe("NativeDuckDBEngine — real native DuckDB", () => {
  let engine: NativeDuckDBEngine | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    await engine?.dispose();
    engine = null;
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
    expect(table.schema.fields.map((f) => f.name)).toEqual(["marker", "v"]);
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
    expect(tables[0]?.getChild("value")?.get(0)).toBe(0);
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

  it("disables temporary spilling for a sandboxed engine", async () => {
    engine = new NativeDuckDBEngine({
      sandboxLimits: {
        memoryBytes: 64 * 1024 * 1024,
        threads: 1,
        maxResultRows: 2_048,
      },
    });
    await engine.initialize();

    const rows = await queryRows(
      engine,
      "SELECT current_setting('temp_directory') AS temp_directory",
    );

    expect(rows).toEqual([{ temp_directory: "" }]);
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

  it("closes the byte source when registration fails before any batch is read", async () => {
    engine = new NativeDuckDBEngine();
    const ipc = tableToIPC(new Table({}), "stream");
    let closed = false;
    const source = (async function* () {
      try {
        yield ipc;
        yield new Uint8Array(0);
      } finally {
        closed = true;
      }
    })();

    await expect(
      engine.registerArrowStream("df_no_columns", source),
    ).rejects.toThrow("has no columns");

    await vi.waitFor(() => expect(closed).toBe(true));
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
    const disconnect = vi.spyOn(DuckDBConnection.prototype, "disconnectSync");
    const iterator = engine
      .queryArrowBatches("SELECT range FROM range(5000)")
      [Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    const disconnectsBeforeDispose = disconnect.mock.calls.length;

    const disposed = engine.dispose().then(() => "disposed" as const);
    const outcome = await Promise.race([
      disposed,
      new Promise<"blocked">((resolve) => {
        setTimeout(() => resolve("blocked"), 500);
      }),
    ]);

    expect(outcome).toBe("disposed");
    // Disposal interrupts the paused operation, whose lease closes its own
    // connection before the native instance closes.
    expect(disconnect.mock.calls.length).toBe(disconnectsBeforeDispose + 1);
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
      await engine.registerArrowBatches(
        "df_enrolled_batches",
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
      await engine.unregisterTable("df_enrolled_batches");
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

  it.each(["buffered registration", "streamed query"] as const)(
    "normalizes an interrupted native call during %s",
    async (operation) => {
      engine = new NativeDuckDBEngine();
      await engine.initialize();
      const controller = new AbortController();
      const nativeError = new Error("INTERRUPT Error: Interrupted!");
      const method = (
        {
          "streamed query": "stream",
          "buffered registration": "run",
        } as const
      )[operation];
      const nativeCall = vi
        .spyOn(DuckDBConnection.prototype, method)
        .mockImplementationOnce(async () => {
          // Cancel only after the operation has entered the native call. This
          // forces the CI race without relying on a timer winning startup.
          controller.abort();
          throw nativeError;
        });
      const arrow = tableToIPC(
        new Table({ v: vectorFromArray([1], new Int32()) }),
      );
      const pending = (async () => {
        switch (operation) {
          case "buffered registration":
            return engine!.registerArrowTable(
              "cancelled",
              arrow,
              controller.signal,
            );
          case "streamed query":
            for await (const _batch of engine!.queryArrowBatches(
              "SELECT 1",
              [],
              controller.signal,
            )) {
              /* drain */
            }
        }
      })();
      await expect(pending).rejects.toBeInstanceOf(DOMException);
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(nativeCall).toHaveBeenCalledTimes(1);
      nativeCall.mockRestore();
      expect(engine.hasTable("cancelled")).toBe(false);
      // Cancellation must release the lease and leave unrelated work usable.
      expect(await queryRows(engine, "SELECT 1 AS v")).toEqual([{ v: 1 }]);
    },
  );

  it("preserves native failures when the operation was not cancelled", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    const failure = new Error("native statement failed");
    vi.spyOn(DuckDBConnection.prototype, "runAndReadAll").mockRejectedValueOnce(
      failure,
    );
    await expect(engine.queryArrow("SELECT 1")).rejects.toBe(failure);
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
    await engine.registerArrowTable(
      "df_buffered_after_failed_appender",
      tableToIPC(new Table({ n: vectorFromArray([1], new Float64()) })),
    );
    expect(
      Number(
        (
          await queryRows(
            engine,
            'SELECT COUNT(*) AS cnt FROM "df_buffered_after_failed_appender"',
          )
        )[0]?.cnt,
      ),
    ).toBe(1);
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

    it("handles high-concurrency registrations without corruption or error", async () => {
      // Stress variant: 8 concurrent uploads across 4 distinct table names
      // (2 per name) — four lock queues two deep, running against each other.
      // Contract: each named table ends with one upload's complete row count;
      // no thrown errors; no leaked staging tables.
      //
      // Dropping same-name serialization surfaces as a catalog write-write
      // conflict on every platform, so this run is discriminating rather than a
      // smoke screen.
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

      // No staging tables should survive. This fresh connection cannot see
      // another connection's TEMP tables, so it pins the absence of a non-temp
      // leftover.
      const leaked = await queryRows(
        engine!,
        `SELECT COUNT(*) AS cnt FROM duckdb_tables()
         WHERE table_name LIKE '__staging_%'`,
      );
      expect(Number(leaked[0]?.cnt)).toBe(0);
    });
  });

  describe("native Arrow batch streaming", () => {
    function batch(values: readonly number[]): Uint8Array {
      return tableToIPC(
        new Table({
          value: vectorFromArray(values, new Int32()),
          label: vectorFromArray(
            values.map((value) => `row-${value}`),
            new Utf8(),
          ),
        }),
      );
    }

    async function* stream(...values: Uint8Array[]) {
      for (const value of values) yield value;
    }

    it("registers multiple self-contained IPC batches as one atomic table", async () => {
      engine = new NativeDuckDBEngine();
      await engine.registerArrowBatches(
        "df_batched",
        stream(batch([1, 2]), batch([3, 4, 5])),
      );

      const result = await queryRows(
        engine,
        'SELECT value, label FROM "df_batched" ORDER BY value',
      );
      expect(result).toEqual([
        { value: 1, label: "row-1" },
        { value: 2, label: "row-2" },
        { value: 3, label: "row-3" },
        { value: 4, label: "row-4" },
        { value: 5, label: "row-5" },
      ]);
      expect(engine.hasTable("df_batched")).toBe(true);
    });

    it("keeps the prior table and engine usable when a later batch changes schema", async () => {
      engine = new NativeDuckDBEngine();
      await engine.registerArrowBatches(
        "df_atomic_batches",
        stream(batch([7])),
      );
      const changed = tableToIPC(
        new Table({ other: vectorFromArray([8], new Int32()) }),
      );

      await expect(
        engine.registerArrowBatches(
          "df_atomic_batches",
          stream(batch([1, 2]), changed),
        ),
      ).rejects.toThrow("Arrow schema changed");

      const result = await queryRows(
        engine,
        'SELECT value FROM "df_atomic_batches"',
      );
      expect(result).toEqual([{ value: 7 }]);
      await engine.registerArrowBatches(
        "df_after_batch_failure",
        stream(batch([9])),
      );
      expect(
        await queryRows(engine, 'SELECT value FROM "df_after_batch_failure"'),
      ).toEqual([{ value: 9 }]);
    });

    it("rolls back an aborted replacement without changing the live table", async () => {
      engine = new NativeDuckDBEngine();
      await engine.registerArrowBatches("df_abort_batches", stream(batch([1])));
      const controller = new AbortController();
      async function* aborting() {
        yield batch([2, 3]);
        controller.abort();
        yield batch([4]);
      }

      await expect(
        engine.registerArrowBatches(
          "df_abort_batches",
          aborting(),
          controller.signal,
        ),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(
        await queryRows(engine, 'SELECT value FROM "df_abort_batches"'),
      ).toEqual([{ value: 1 }]);
    });

    it("closes a connection when abort wins the pending connect race", async () => {
      engine = new NativeDuckDBEngine();
      await engine.initialize();
      const instance = (engine as unknown as { instance: DuckDBInstance })
        .instance;
      const operationConnection = await instance.connect();
      const disconnect = vi.spyOn(DuckDBConnection.prototype, "disconnectSync");
      let releaseConnection!: (connection: DuckDBConnection) => void;
      let markConnectRequested!: () => void;
      const connectRequested = new Promise<void>((resolve) => {
        markConnectRequested = resolve;
      });
      const pendingConnection = new Promise<DuckDBConnection>((resolve) => {
        releaseConnection = resolve;
      });
      vi.spyOn(instance, "connect").mockImplementationOnce(() => {
        markConnectRequested();
        return pendingConnection;
      });
      const controller = new AbortController();
      const next = engine
        .queryArrowBatches("SELECT 1 AS value", [], controller.signal)
        [Symbol.asyncIterator]()
        .next();

      await connectRequested;
      controller.abort();
      releaseConnection(operationConnection);

      await expect(next).rejects.toMatchObject({ name: "AbortError" });
      expect(disconnect).toHaveBeenCalledOnce();
    });

    it("closes its operation query connection when the consumer returns early", async () => {
      engine = new NativeDuckDBEngine();
      const disconnect = vi.spyOn(DuckDBConnection.prototype, "disconnectSync");
      const iterator = engine
        .queryArrowBatches("SELECT range AS value FROM range(5000)")
        [Symbol.asyncIterator]();

      expect((await iterator.next()).done).toBe(false);
      const disconnectsBeforeReturn = disconnect.mock.calls.length;
      await iterator.return?.();

      expect(disconnect.mock.calls.length).toBe(disconnectsBeforeReturn + 1);
      expect(await queryRows(engine, "SELECT 1 AS alive")).toEqual([
        { alive: 1 },
      ]);
    });

    it("dispose does not wait indefinitely for a paused batch producer", async () => {
      engine = new NativeDuckDBEngine();
      let markWaiting!: () => void;
      const waiting = new Promise<void>((resolve) => {
        markWaiting = resolve;
      });
      const never = new Promise<void>(() => {});
      async function* pausedProducer() {
        yield batch([1]);
        markWaiting();
        await never;
      }

      const registration = engine.registerArrowBatches(
        "df_paused_producer",
        pausedProducer(),
      );
      const outcome = registration.then(
        () => null,
        (error: unknown) => error,
      );
      await waiting;
      await engine.dispose();

      expect(await outcome).toMatchObject({ name: "AbortError" });
      expect(engine.isReady()).toBe(false);
    });
  });
});
