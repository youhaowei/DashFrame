/**
 * Stage 3 — Execute: the native DuckDB engine.
 *
 * The primary `QueryEngine` for the **server process** (desktop loopback today;
 * headless `serve` + web-via-server is the same class). Desktop and web share
 * this implementation so the data plane stays consistent; DuckDB-WASM in
 * `@dashframe/engine-browser` is a **backup / local-first** path, not a second
 * peer `QueryEngine` and not the long-term web default.
 *
 * Electron main and headless `serve` both construct this engine and mount Stage
 * 5. Cloud remote compute is not a binding; this class is the intended seam
 * there too once that tier exists.
 *
 * Beyond the row-shaped `QueryEngine.query`, it exposes `queryArrow` — the
 * Arrow IPC bytes the dedicated data path (Stage 5) streams. Arrow encoding is
 * delegated to `apache-arrow` rather than DuckDB's Arrow extension, so the binary
 * format matches what clients ingest (including the WASM backup path) and stays
 * in one well-exercised library.
 *
 * `registerArrowTable` accepts an Arrow IPC stream buffer, decodes it with
 * apache-arrow, and ingests it into an in-memory DuckDB table via the typed
 * Appender API. `registerTable(DataFrame)` is intentionally unsupported — use
 * Arrow upload or direct source SQL. Row data stays in process memory (privacy
 * floor: sensitive data is never at rest outside the gated cache; see #67).
 * Tables persist for the session lifetime and are re-registered on reconnect.
 *
 * Two-Arrow-library seam: this side decodes with `apache-arrow`, but the chart
 * layer (Mosaic / `@uwdata/vgplot`) decodes the same IPC with `@uwdata/flechette`.
 * They share the wire format but NOT JS value semantics (`.get()` differs per
 * type — Date32/64 is the known case). Value-translation knowledge currently
 * lives in the type switches below; the planned consolidation into one
 * anti-corruption bridge is tracked in #95 (triggered at the 3rd cross-library
 * type). When adding an Arrow type here, pin a value-equality check across the seam.
 */
import type { DataFrame, QueryEngine, QueryResult } from "@dashframe/engine";
import type { TableColumn } from "@dashframe/types";
import {
  DuckDBDateValue,
  DuckDBInstance,
  DuckDBTimestampValue,
  JsonDuckDBValueConverter,
  type DuckDBConnection as Connection,
  type DuckDBAppender,
  type DuckDBValue,
} from "@duckdb/node-api";
import {
  RecordBatchReader,
  Type as ArrowType,
  tableFromIPC,
  type Field,
  type RecordBatch,
} from "apache-arrow";

import {
  duckdbColumnsToArrowIpc,
  duckdbTypeIdToColumnType,
  type ResultColumn,
} from "./arrow-encode";

/**
 * Deny filesystem and network access on `connection`, then lock the
 * configuration so user SQL cannot restore it.
 *
 * Order matters: `lock_configuration` must be set LAST, because it also locks
 * itself and every setting after it. The lock is what makes this a boundary
 * rather than a default — without it a chart query could simply issue
 * `SET enable_external_access=true` first.
 *
 * Applied once, on the connection opened at initialize(). These settings are
 * scoped to the DATABASE INSTANCE, not to the connection: a later connection
 * from the same instance — the one the appender-taint recovery path opens —
 * inherits them already locked and cannot lift them. Verified against
 * @duckdb/node-api 1.5.3-r.3. A separate instance is independently configured,
 * which is what makes a per-workspace instance a meaningful unit.
 */
async function applyAccessRestrictions(
  connection: Connection,
  restrict: boolean,
): Promise<void> {
  if (!restrict) return;
  await connection.run("SET enable_external_access=false");
  await connection.run("SET allow_unsigned_extensions=false");
  await connection.run("SET lock_configuration=true");
}

export interface NativeDuckDBEngineOptions {
  /** Additional fixed limits for an OS-isolated worker; never a sandbox alone. */
  sandboxLimits?: {
    memoryBytes: number;
    threads: number;
    maxResultRows: number;
  };
  /**
   * DuckDB database path. Default `:memory:` — an in-memory database.
   *
   * The cache-write gate (see #67) keeps sensitive columns memory-only by
   * excluding them from the on-disk Parquet cache (Stage 4); the engine's own
   * working database is in-memory by default so a session leaves nothing at
   * rest unless a query is explicitly cached.
   */
  databasePath?: string;
  /**
   * Deny DuckDB every filesystem and network primitive, and lock that decision
   * so no later statement can undo it. Defaults to `true`.
   *
   * This engine executes SQL that originates in the browser: Mosaic composes
   * chart queries client-side and posts them to the Arrow data path, which
   * checks only that the statement mentions the frame it names. Everything else
   * in the statement runs as written. Without this, `read_text('/proc/self/environ')`,
   * `ATTACH`, `COPY ... TO` and `INSTALL` are all reachable from a chart — an
   * arbitrary read of, and write to, whatever the host process can touch.
   *
   * Nothing in DashFrame needs the access it removes. Frame data reaches DuckDB
   * through `registerArrowTable`, which decodes Arrow in-process and inserts via
   * the typed Appender API — no file is read by the database engine. A
   * file-backed `databasePath` keeps working: the database file is attached
   * before these settings apply, and reads, writes and CHECKPOINT against it are
   * unaffected.
   *
   * Set it to `false` only for a caller that genuinely needs DuckDB to touch the
   * filesystem — the Parquet cache is the one such consumer — and only where the
   * SQL reaching that engine cannot come from a client.
   */
  restrictFileAccess?: boolean;
}

/**
 * Where the engine is in its life. One field, one transition graph:
 *
 *   idle ──initialize()──▶ initializing ──ok──▶ ready
 *                               │ fail                 │
 *                               ▼                      │
 *                             idle                     │
 *   any ──dispose()──▶ disposing ──drained──▶ disposed ◀┘
 *
 * `disposing` is the teardown window: the lifecycle signal has fired but the
 * persistent connection is still live while dispose() drains enrolled
 * operations. Naming it is the point — every "the guard was in the wrong
 * place" bug this class has had lived in that window while it had no name.
 */
type LifecyclePhase =
  | "idle"
  | "initializing"
  | "ready"
  | "disposing"
  | "disposed";

/**
 * What `acquireConnection()` hands out: a connection that is enrolled in the
 * lifecycle for as long as the lease is held. `release()` is idempotent.
 */
interface ConnectionLease {
  readonly connection: Connection;
  /** Caller signal (if any) joined with the lifecycle signal. */
  readonly signal: AbortSignal;
  release(): void;
}

interface AcquireOptions {
  /** Caller cancellation, joined with the lifecycle signal. */
  signal?: AbortSignal;
  /**
   * Take the global registration lock before resolving the connection. DuckDB
   * appenders are not concurrent-safe on a shared connection, so every
   * registration-shaped operation serializes here.
   */
  serialize?: boolean;
  /**
   * Open a private connection from the instance instead of handing out the
   * persistent one. Streaming reads and streaming ingest need this: they hold
   * a native result open across awaits and accept a caller signal, and
   * interrupting the shared connection on a caller's cancel would cancel
   * everyone else's statement too.
   */
  dedicated?: boolean;
}

export class NativeDuckDBEngine implements QueryEngine {
  private readonly sandboxLimits: NativeDuckDBEngineOptions["sandboxLimits"];
  private readonly databasePath: string;
  private readonly restrictFileAccess: boolean;
  private phase: LifecyclePhase = "idle";
  private instance: DuckDBInstance | null = null;
  /**
   * The persistent connection. Written only by the lifecycle methods
   * (`initialize`, `dispose`, `replaceTaintedConnection`); read only by
   * `acquireConnection` (via `persistentConnection`) and `isReady`. Every
   * query and registration receives it as a lease argument instead.
   */
  private connection: Connection | null = null;
  /**
   * Memoized in-flight initialization. The first caller installs the promise;
   * concurrent callers await the SAME one instead of each racing to create a
   * second `DuckDBInstance` (which would leak the loser's native handle,
   * background threads, and any file lock on the database path).
   */
  private initPromise: Promise<void> | null = null;
  /** Memoized teardown, so a second dispose() joins the first. */
  private disposal: Promise<void> | null = null;
  /**
   * Set of table names currently registered via `registerArrowTable`. Used to
   * answer `hasTable`/`getTableNames` without an async DB round-trip.
   */
  private _registeredTables = new Set<string>();
  /**
   * Global serializer for registrations. DuckDB appenders are not
   * concurrent-safe on a shared connection — two in-flight registrations
   * sharing `this.connection` can trigger the "pending-result" NAPI taint that
   * kills the next operation on the connection.
   *
   * The lock is a promise chain: each caller captures the previous tail, then
   * installs a new tail whose resolution (`unlock`) it calls in `finally`. Only
   * one registration runs at a time; arrivals queue in order.
   *
   * Global (not per-name) because the taint is per-connection, not per-table:
   * two concurrent registrations for *different* names share the same
   * `this.connection` and race just as badly.
   */
  private _registrationLock: Promise<void> = Promise.resolve();
  /**
   * Fires once, on the transition to `disposing`. The phase is the state; this
   * is how in-flight operations hear about it — joined into every lease signal
   * so a native statement is interrupted, and a registration that was queued
   * on the lock fails as soon as it acquires it.
   */
  private readonly lifecycleAbort = new AbortController();
  private activeNativeOperations = 0;
  private operationsIdle: Promise<void> | null = null;
  private resolveOperationsIdle: (() => void) | null = null;
  /**
   * Streaming queries paused at a `yield` hold a lease the consumer may never
   * resume. dispose() cannot drain those by waiting, so it tracks the
   * generators and calls `return()` on each, which runs their `finally`.
   */
  private activeQueryIterators = new Set<AsyncGenerator<Uint8Array>>();

  constructor(options: NativeDuckDBEngineOptions = {}) {
    this.sandboxLimits = options.sandboxLimits;
    if (
      this.sandboxLimits &&
      Object.values(this.sandboxLimits).some(
        (value) => !Number.isSafeInteger(value) || value <= 0,
      )
    )
      throw new Error("Invalid sandbox engine limits");
    this.databasePath = options.databasePath ?? ":memory:";
    this.restrictFileAccess = options.restrictFileAccess ?? true;
  }

  async initialize(): Promise<void> {
    switch (this.phase) {
      case "ready":
        return;
      case "disposing":
      case "disposed":
        // Disposal is terminal. Re-opening here would build a fresh
        // DuckDBInstance the owner will never close — a leaked native handle,
        // its background threads, and any file lock on a non-:memory: path.
        // Checking the phase (not the connection) is what makes this hold in
        // the teardown window too, where the connection is still live.
        throw disposedError();
      case "initializing":
        break;
      case "idle":
        // Latch the first call's promise so concurrent callers converge on one
        // instance: the awaits below yield, and a plain null check on the
        // connection would let two callers both create an instance.
        this.phase = "initializing";
        this.initPromise = this.openInstance().then(
          ({ instance, connection }) => {
            this.instance = instance;
            this.connection = connection;
            // A dispose() that raced this init is already parked on
            // `initPromise`; it takes the handles from here and closes them.
            if (this.phase === "initializing") this.phase = "ready";
          },
          (err: unknown) => {
            // A failed init must not be cached — return to `idle` so a later
            // call can retry rather than re-await a permanently-rejected
            // promise. A dispose() that raced us keeps its own phase.
            if (this.phase === "initializing") this.phase = "idle";
            this.initPromise = null;
            throw err;
          },
        );
        break;
    }
    await this.initPromise;
  }

  private async openInstance(): Promise<{
    instance: DuckDBInstance;
    connection: Connection;
  }> {
    const instance = await DuckDBInstance.create(
      this.databasePath,
      this.sandboxLimits
        ? {
            memory_limit: `${this.sandboxLimits.memoryBytes}B`,
            threads: String(this.sandboxLimits.threads),
            temp_directory: "",
            autoinstall_known_extensions: "false",
            autoload_known_extensions: "false",
          }
        : undefined,
    );
    let connection: Connection;
    try {
      connection = await instance.connect();
    } catch (err) {
      // connect() failing would otherwise leak the just-created instance
      // (native handle, background threads, file lock on a non-:memory:
      // path) — it was never assigned to this.instance, so nothing else
      // could ever close it. Close it before surfacing the error.
      instance.closeSync();
      throw err;
    }
    try {
      await applyAccessRestrictions(connection, this.restrictFileAccess);
    } catch (err) {
      // The restriction is a security control, not a tuning knob. If it
      // cannot be applied, the engine must not come up serving client SQL
      // with the restriction silently absent.
      connection.closeSync();
      instance.closeSync();
      throw err;
    }
    return { instance, connection };
  }

  isReady(): boolean {
    return this.connection !== null;
  }

  /**
   * The only way to reach a native handle. Enrols the caller in the lifecycle
   * FIRST, so dispose() waits on `operationsIdle` for the lease instead of
   * disconnecting under it; then checks the joined signal so a lease requested
   * in the teardown window fails with the lifecycle abort before touching
   * anything native.
   *
   * Ordering that the tests pin for an unserialized persistent lease: the
   * handle is resolved before the abort check. After dispose() has *finished*
   * the handle is gone and callers must hear "not initialized"; while it is
   * *in progress* the handle is live and they must hear the abort.
   *
   * A serialized lease re-checks the signal after the lock wait — a queued
   * registration can sit there across a dispose() — and resolves the
   * persistent handle only then, because a registration ahead of it in the
   * queue may have replaced the connection (`replaceTaintedConnection`).
   */
  private async acquireConnection(
    options: AcquireOptions = {},
  ): Promise<ConnectionLease> {
    const {
      signal: callerSignal,
      serialize = false,
      dedicated = false,
    } = options;
    const signal = this.beginNativeOperation(callerSignal);
    let unlock: (() => void) | undefined;
    let connection: Connection | undefined;
    let interrupt: (() => void) | undefined;
    let released = false;
    // Every step runs even if an earlier one throws: a disconnect that fails
    // must still hand back the lock and the refcount, or every later
    // registration queues forever and dispose() never drains.
    const release = () => {
      if (released) return;
      released = true;
      try {
        if (interrupt) signal.removeEventListener("abort", interrupt);
        if (dedicated) connection?.disconnectSync();
      } finally {
        try {
          unlock?.();
        } finally {
          this.endNativeOperation();
        }
      }
    };
    try {
      // Persistent, unserialized leases resolve the handle up front so a
      // caller on a disposed engine hears "not initialized". A serialized
      // lease must not: the registration holding the lock may be mid-swap in
      // replaceTaintedConnection, with the handle null until it reconnects.
      if (!dedicated && !serialize) this.persistentConnection();
      throwIfAborted(signal);
      if (serialize) {
        unlock = await this.acquireRegistrationLock();
        throwIfAborted(signal);
      }
      const leased = dedicated
        ? await this.liveInstance().connect()
        : this.persistentConnection();
      connection = leased;
      // Every lease interrupts its statement on abort. Enrolling makes
      // dispose() wait for the operation; without a way to stop it, a long or
      // nonterminating query would turn into a hung shutdown, since both the
      // desktop and standalone hosts await dispose(). A persistent lease
      // carries only the lifecycle signal, so this fires only at teardown.
      // Listener first, then re-check: an abort that landed during connect()
      // would otherwise never reach interrupt().
      interrupt = () => leased.interrupt();
      signal.addEventListener("abort", interrupt, { once: true });
      throwIfAborted(signal);
      return { connection, signal, release };
    } catch (err) {
      release();
      throw err;
    }
  }

  /** Run `run` against a leased connection; the lease ends when it settles. */
  private async withConnection<T>(
    run: (connection: Connection, signal: AbortSignal) => Promise<T>,
    options?: AcquireOptions,
  ): Promise<T> {
    const lease = await this.acquireConnection(options);
    try {
      return await run(lease.connection, lease.signal);
    } finally {
      lease.release();
    }
  }

  /**
   * Generator twin of `withConnection`: the lease spans every `yield`, and
   * ends when the consumer finishes, throws, or calls `return()` — which is
   * how dispose() closes a stream paused at a yielded batch.
   */
  private async *streamWithConnection(
    run: (
      connection: Connection,
      signal: AbortSignal,
    ) => AsyncGenerator<Uint8Array>,
    options?: AcquireOptions,
  ): AsyncGenerator<Uint8Array> {
    const lease = await this.acquireConnection(options);
    try {
      yield* run(lease.connection, lease.signal);
    } finally {
      lease.release();
    }
  }

  private persistentConnection(): Connection {
    if (!this.connection) {
      throw new Error(
        "NativeDuckDBEngine not initialized — call initialize() first",
      );
    }
    return this.connection;
  }

  private liveInstance(): DuckDBInstance {
    if (!this.instance) {
      throw new Error(
        "NativeDuckDBEngine not initialized — call initialize() first",
      );
    }
    return this.instance;
  }

  private async acquireRegistrationLock(): Promise<() => void> {
    const gate = this._registrationLock;
    let unlock!: () => void;
    this._registrationLock = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await gate;
    return unlock;
  }

  /**
   * Swap out the persistent connection after an appender failure.
   *
   * On Linux, duckdb_appender_close() on a failed appender marks the
   * connection with a pending-result error. The next duckdb_query() on the
   * same connection fails with "Attempting to execute an unsuccessful or
   * closed pending query result" — emitted as an unhandled NAPI-layer
   * rejection that bypasses the surrounding try/catch. Leaving the persistent
   * connection tainted relocates that flake to the NEXT operation instead of
   * killing it, so the tainted connection is disconnected and replaced with a
   * fresh one from the same instance. Closing the old connection also drops
   * its TEMP tables — including the partial staging table — for free.
   *
   * Called only under the registration lock, from an enrolled lease.
   */
  private async replaceTaintedConnection(): Promise<void> {
    try {
      this.connection?.disconnectSync();
    } catch {
      // best-effort — continue to reconnect even if disconnect throws
    }
    this.connection = null;
    try {
      // No need to re-apply the access restrictions here: they belong to
      // the instance, not to this connection, and are already locked.
      this.connection = await this.liveInstance().connect();
    } catch {
      // Reconnect failed — engine is unusable; the next lease reports
      // "not initialized".
    }
  }

  async query(sql: string): Promise<QueryResult> {
    return this.withConnection(async (connection) => {
      const reader = await connection.runAndReadAll(sql);
      const columnNames = reader.columnNames();
      const columnTypes = reader.columnTypes();
      const rows = reader.getRowObjectsJson() as Record<string, unknown>[];

      const columns: TableColumn[] = columnNames.map((name, i) => ({
        name,
        type: duckdbTypeIdToColumnType(columnTypes[i]?.typeId),
      }));

      return { columns, rows, rowCount: rows.length };
    });
  }

  /**
   * Execute `sql` (with optional positional `params`) and return the result as
   * an Arrow IPC stream buffer — the payload the data path (Stage 5) serves as
   * `application/vnd.apache.arrow.stream`.
   *
   * Params bind through DuckDB's native positional binding (the `values`
   * argument of `runAndReadAll`), NOT string substitution. Text-scanning every
   * `?` would also rewrite question marks inside string literals or comments
   * (`SELECT '?' AS marker, ? AS v`), corrupting the query — native binding
   * only substitutes real placeholders.
   */
  async queryArrow(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<Uint8Array> {
    return this.withConnection(async (connection) => {
      const values = params.length > 0 ? (params as DuckDBValue[]) : undefined;
      const reader = this.sandboxLimits
        ? await connection.runAndReadUntil(
            sql,
            this.sandboxLimits.maxResultRows + 1,
            values,
          )
        : await connection.runAndReadAll(sql, values);
      if (
        this.sandboxLimits &&
        reader.currentRowCount > this.sandboxLimits.maxResultRows
      )
        throw new Error("Sandbox result row limit exceeded");
      const columnNames = reader.columnNames();
      const columnTypes = reader.columnTypes();
      const columnsObject = reader.getColumnsObjectJson() as Record<
        string,
        unknown[]
      >;

      const columns: ResultColumn[] = columnNames.map((name, i) => ({
        name,
        typeId: columnTypes[i]?.typeId,
        values: columnsObject[name] ?? [],
      }));

      return duckdbColumnsToArrowIpc(columns);
    });
  }

  queryArrowBatches(
    sql: string,
    params: readonly unknown[] = [],
    signal?: AbortSignal,
  ): AsyncIterable<Uint8Array> {
    const iterator = this.trackedQueryStream(sql, params, signal, {
      onStarted: () => this.activeQueryIterators.add(iterator),
      onClosed: () => this.activeQueryIterators.delete(iterator),
    });
    return iterator;
  }

  private async *trackedQueryStream(
    sql: string,
    params: readonly unknown[],
    signal: AbortSignal | undefined,
    track: { onStarted: () => void; onClosed: () => void },
  ): AsyncGenerator<Uint8Array> {
    track.onStarted();
    try {
      await this.initialize();
      yield* this.streamWithConnection(
        (connection, operationSignal) =>
          this.streamBatches(connection, operationSignal, sql, params),
        { signal, dedicated: true },
      );
    } finally {
      track.onClosed();
    }
  }

  private async *streamBatches(
    connection: Connection,
    signal: AbortSignal,
    sql: string,
    params: readonly unknown[],
  ): AsyncGenerator<Uint8Array> {
    const result =
      params.length > 0
        ? await connection.stream(sql, params as DuckDBValue[])
        : await connection.stream(sql);
    const names = result.columnNames();
    const types = result.columnTypes();
    let yielded = false;
    let rowCount = 0;
    while (true) {
      throwIfAborted(signal);
      const chunk = await result.fetchChunk();
      if (!chunk || chunk.rowCount === 0) break;
      rowCount += chunk.rowCount;
      if (this.sandboxLimits && rowCount > this.sandboxLimits.maxResultRows) {
        throw new Error("Sandbox result row limit exceeded");
      }
      yielded = true;
      yield duckdbColumnsToArrowIpc(
        names.map((name, index) => ({
          name,
          typeId: types[index]?.typeId,
          values: chunk.convertColumnValues(index, JsonDuckDBValueConverter),
        })),
      );
    }
    if (!yielded) {
      yield duckdbColumnsToArrowIpc(
        names.map((name, index) => ({
          name,
          typeId: types[index]?.typeId,
          values: [],
        })),
      );
    }
    throwIfAborted(signal);
  }

  /**
   * Register an Arrow IPC stream buffer as a named in-memory DuckDB table.
   *
   * The renderer uploads each DataFrame's Arrow IPC buffer before issuing
   * chart-compute queries; the native engine then has the table available for
   * the duration of the session. On reconnect the renderer re-registers any
   * tables it needs.
   *
   * Implementation: decode with apache-arrow, create the table with a schema
   * derived from the Arrow schema, and stream rows in through DuckDB's typed
   * Appender. The whole path is in-memory — row data never touches the
   * filesystem (privacy floor: sensitive data is never at rest outside the
   * gated cache), and typed appends preserve timestamps/dates exactly instead
   * of round-tripping through JSON strings.
   */
  async registerArrowTable(name: string, arrow: Uint8Array): Promise<void> {
    await this.initialize();
    await this.withConnection(
      async (conn) => {
        // Decode the Arrow IPC stream buffer.
        const arrowTable = tableFromIPC(arrow);
        const fields = arrowTable.schema.fields;
        if (fields.length === 0) {
          throw new Error(`Arrow buffer for table "${name}" has no columns`);
        }

        // Create a session-scoped TEMP table for staging — if the append fails
        // partway through, the live table is untouched (atomic all-or-nothing).
        // TEMP tables are connection-local: DuckDB drops them automatically when
        // the owning connection closes. On the success path, the explicit DROP
        // after the swap keeps stale staging tables from accumulating across
        // repeated registerArrowTable calls. On the failure path, the catch block
        // replaces the connection, so the staging table is dropped then too.
        //
        // The staging name carries a per-call unique suffix so that the
        // intermediate per-table catalog entry is distinct per upload even
        // though only one registration runs at a time (the suffix is still
        // useful if the same engine is ever queried while a registration is
        // in-flight, and it documents intent clearly).
        const stagingName = `__staging_${name}_${nextStagingId()}`;
        const columnDefs = fields
          .map((f) => `${quoteIdent(f.name)} ${arrowFieldToDuckDBType(f)}`)
          .join(", ");
        await conn.run(
          `CREATE OR REPLACE TEMP TABLE ${quoteIdent(stagingName)} (${columnDefs})`,
        );

        // Stream rows into the staging table — no disk, no string round-trip.
        const appender = await conn.createAppender(stagingName);
        try {
          const columns = fields.map((f) => ({
            field: f,
            vector: arrowTable.getChild(f.name),
          }));
          const rowCount = arrowTable.numRows;
          for (let i = 0; i < rowCount; i++) {
            for (const col of columns) {
              appendArrowValue(appender, col.field, col.vector?.get(i));
            }
            appender.endRow();
          }
          appender.flushSync();
        } catch (err) {
          // Append failed — staging table may be partially written.
          try {
            appender.closeSync();
          } catch {
            // ignore close error — propagate original
          }
          // `conn` is the persistent connection, and a failed appender may
          // have tainted it (see replaceTaintedConnection).
          await this.replaceTaintedConnection();
          throw err;
        }
        // Flush succeeded — close the appender before the swap.
        try {
          appender.closeSync();
        } catch {
          // close failure after a successful flush must not abort the swap
        }

        // Atomic swap: replace the live table with the fully-ingested staging
        // copy. Both DDL statements run in the same connection, so the live
        // table is never observable in a half-replaced state.
        await conn.run(
          `CREATE OR REPLACE TABLE ${quoteIdent(name)} AS SELECT * FROM ${quoteIdent(stagingName)}`,
        );
        await conn.run(`DROP TABLE IF EXISTS ${quoteIdent(stagingName)}`);

        this._registeredTables.add(name);
      },
      { serialize: true },
    );
  }

  async registerArrowStream(
    name: string,
    rawIPCStream: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<void> {
    // An already-cancelled caller must not pay for DuckDB startup.
    throwIfAborted(signal);
    await this.initialize();
    await this.withConnection(
      async (conn, operationSignal) => {
        const reader = await RecordBatchReader.from(
          abortableBytes(rawIPCStream, operationSignal),
        );
        await reader.open();
        const fields = reader.schema.fields;
        if (fields.length === 0) {
          throw new Error(`Arrow stream for table "${name}" has no columns`);
        }
        const stagingName = `__staging_${name}_${nextStagingId()}`;
        const columnDefs = fields
          .map(
            (field) =>
              `${quoteIdent(field.name)} ${arrowFieldToDuckDBType(field)}`,
          )
          .join(", ");
        await conn.run(
          `CREATE OR REPLACE TEMP TABLE ${quoteIdent(stagingName)} (${columnDefs})`,
        );
        let appender: DuckDBAppender | undefined;
        try {
          appender = await conn.createAppender(stagingName);
          for await (const batch of reader) {
            throwIfAborted(operationSignal);
            if (!sameArrowFields(fields, batch.schema.fields)) {
              throw new Error(
                "Arrow batch schema does not match the first batch",
              );
            }

            appendArrowBatch(appender, fields, batch, operationSignal);
            appender!.flushSync();
          }
          throwIfAborted(operationSignal);
          appender.closeSync();
          appender = undefined;
          await conn.run(
            `CREATE OR REPLACE TABLE ${quoteIdent(name)} AS SELECT * FROM ${quoteIdent(stagingName)}`,
          );
          this._registeredTables.add(name);
        } finally {
          if (appender) {
            try {
              appender.closeSync();
            } catch {
              // The lease disconnects this dedicated connection on release,
              // discarding it and its TEMP state.
            }
          }
        }
      },
      { signal, serialize: true, dedicated: true },
    );
  }

  async registerTable(_name: string, _dataFrame: DataFrame): Promise<void> {
    throw new Error(
      "NativeDuckDBEngine.registerTable is not supported — upload Arrow IPC via registerArrowTable, or query sources directly (read_parquet)",
    );
  }

  async unregisterTable(name: string): Promise<void> {
    await this.initialize();
    await this.withConnection(
      async (connection) => {
        if (!this._registeredTables.has(name)) return;
        await connection.run(`DROP TABLE IF EXISTS ${quoteIdent(name)}`);
        // Forget the registration only after DuckDB confirms the DROP. A
        // transient native failure must leave the entry discoverable so cleanup
        // can retry instead of leaking a table the registry claims is gone.
        this._registeredTables.delete(name);
      },
      { serialize: true },
    );
  }

  hasTable(name: string): boolean {
    return this._registeredTables.has(name);
  }

  getTableNames(): string[] {
    return [...this._registeredTables];
  }

  dispose(): Promise<void> {
    // Memoized: a second dispose() joins the first instead of tearing down
    // twice (a finally-block and an afterEach teardown may both call it).
    this.disposal ??= this.teardown();
    return this.disposal;
  }

  private async teardown(): Promise<void> {
    // Transition and abort synchronously, before the first await. On a fresh
    // engine `initPromise` is null, and `await null` still yields a microtask
    // — an initialize() arriving in that window would otherwise build an
    // instance this teardown has already walked past, and leave it live with
    // nothing left to close it.
    this.phase = "disposing";
    this.lifecycleAbort.abort(disposedError());
    // An initialize() may still be in flight (e.g. Electron before-quit fires
    // during DuckDB startup). Tearing down immediately would null out nothing,
    // and the init closure would then assign a live connection/instance AFTER
    // this teardown — an engine alive past disposal, its native handle and any
    // file lock never released. Wait for the latch to settle first; a failed
    // init has already cleaned up after itself, so its error is swallowed.
    try {
      await this.initPromise;
    } catch {
      // Failed init closed its own instance — nothing live to tear down.
    }
    const activeQueries = [...this.activeQueryIterators];
    await Promise.allSettled(
      activeQueries.map((iterator) => iterator.return(undefined)),
    );
    for (const iterator of activeQueries)
      this.activeQueryIterators.delete(iterator);
    await this.operationsIdle;
    this._registeredTables.clear();
    // Disconnect the connection before closing the instance — DuckDB expects
    // all connections to be released before the instance is closed. Teardown
    // is best effort and memoized: a throw here would be cached as a rejected
    // dispose() and leave the instance (and any file lock) open for good.
    try {
      this.connection?.disconnectSync();
    } catch {
      // Already disconnected — closing the instance below still releases it.
    }
    this.connection = null;
    // Close the native instance: releases the background I/O threads, the
    // file lock on the database path, and any native heap the instance holds.
    // The init-failure path already calls closeSync() inline; tolerating an
    // already-closed instance here keeps teardown from throwing on it.
    try {
      this.instance?.closeSync();
    } catch {
      // Already closed — safe to ignore.
    }
    this.instance = null;
    this.initPromise = null;
    this.phase = "disposed";
  }

  private beginNativeOperation(signal?: AbortSignal): AbortSignal {
    this.activeNativeOperations += 1;
    if (this.activeNativeOperations === 1) {
      this.operationsIdle = new Promise<void>((resolve) => {
        this.resolveOperationsIdle = resolve;
      });
    }
    return signal
      ? AbortSignal.any([signal, this.lifecycleAbort.signal])
      : this.lifecycleAbort.signal;
  }

  private endNativeOperation(): void {
    this.activeNativeOperations -= 1;
    if (this.activeNativeOperations === 0) {
      this.resolveOperationsIdle?.();
      this.resolveOperationsIdle = null;
      this.operationsIdle = null;
    }
  }
}

function disposedError(): DOMException {
  return new DOMException("NativeDuckDBEngine disposed", "AbortError");
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted", "AbortError");
  }
}

async function* abortableBytes(
  source: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (true) {
      const result = await nextOrAbort(iterator, signal);
      if (result.done) return;
      yield result.value;
    }
  } finally {
    // An arbitrary provider may ignore cancellation while its next() is
    // pending. Request closure, but do not let that non-cooperative promise
    // prevent native connection cleanup or engine disposal.
    try {
      const closing = iterator.return?.();
      if (closing) Promise.resolve(closing).catch(() => undefined);
    } catch {
      // The native operation is already cancelled; provider cleanup is best effort.
    }
  }
}

function nextOrAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("The operation was aborted", "AbortError"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    iterator.next().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function sameArrowFields(
  expected: readonly Field[],
  actual: readonly Field[],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every(
      (field, index) =>
        field.name === actual[index]?.name &&
        field.type.toString() === actual[index]?.type.toString(),
    )
  );
}

function appendArrowBatch(
  appender: DuckDBAppender,
  fields: readonly Field[],
  batch: RecordBatch,
  signal: AbortSignal,
): void {
  const columns = fields.map((field) => ({
    field,
    vector: batch.getChild(field.name),
  }));
  for (let row = 0; row < batch.numRows; row++) {
    throwIfAborted(signal);
    for (const column of columns) {
      appendArrowValue(appender, column.field, column.vector?.get(row));
    }
    appender.endRow();
  }
}

const MS_PER_DAY = 86_400_000;

/**
 * Monotonic counter for unique staging-table names. A process-local counter is
 * sufficient: staging tables are session-scoped to one DuckDB connection, and
 * the only collision we need to avoid is two in-flight registrations of the
 * same live table racing on a shared deterministic staging name.
 */
let stagingCounter = 0;
function nextStagingId(): number {
  stagingCounter += 1;
  return stagingCounter;
}

/**
 * Map an Arrow schema field to a DuckDB column type for table DDL.
 *
 * The renderer's producer (`createArrowIPCBufferFromRows` in engine-browser)
 * emits exactly four Arrow types — Float64, Bool, TimestampMillisecond, Utf8 —
 * which map losslessly here. Int/Date are covered for robustness against
 * future producers; anything else degrades to VARCHAR via String().
 */
type ArrowValueAppender = (appender: DuckDBAppender, value: unknown) => void;

type ArrowTypeAdapter = {
  duckdbType: string;
  append: ArrowValueAppender;
};

const VARCHAR_ARROW_ADAPTER: ArrowTypeAdapter = {
  duckdbType: "VARCHAR",
  append: (appender, value) => appender.appendVarchar(String(value)),
};

/**
 * One adapter table owns both sides of Arrow -> DuckDB conversion. Keeping the
 * DDL type and Appender operation together prevents those formerly independent
 * switches from accepting a type differently.
 */
const ARROW_TYPE_ADAPTERS: Partial<Record<ArrowType, ArrowTypeAdapter>> = {
  [ArrowType.Bool]: {
    duckdbType: "BOOLEAN",
    append: (appender, value) => appender.appendBoolean(Boolean(value)),
  },
  [ArrowType.Int]: {
    duckdbType: "BIGINT",
    append: (appender, value) =>
      appender.appendBigInt(
        typeof value === "bigint" ? value : BigInt(Math.trunc(Number(value))),
      ),
  },
  [ArrowType.Float]: {
    duckdbType: "DOUBLE",
    append: (appender, value) => appender.appendDouble(Number(value)),
  },
  [ArrowType.Timestamp]: {
    duckdbType: "TIMESTAMP",
    // Arrow JS yields epoch millis; DuckDB TIMESTAMP stores micros.
    append: (appender, value) =>
      appender.appendTimestamp(
        new DuckDBTimestampValue(BigInt(Math.round(Number(value))) * 1000n),
      ),
  },
  [ArrowType.Date]: {
    duckdbType: "DATE",
    append: (appender, value) =>
      appender.appendDate(new DuckDBDateValue(arrowDateToDuckDBDays(value))),
  },
  [ArrowType.Utf8]: VARCHAR_ARROW_ADAPTER,
  [ArrowType.LargeUtf8]: VARCHAR_ARROW_ADAPTER,
};

function arrowTypeAdapter(field: Field): ArrowTypeAdapter {
  return (
    ARROW_TYPE_ADAPTERS[field.type.typeId as ArrowType] ?? VARCHAR_ARROW_ADAPTER
  );
}

function arrowFieldToDuckDBType(field: Field): string {
  return arrowTypeAdapter(field).duckdbType;
}

/**
 * Append one Arrow value to a DuckDB Appender using the typed append method
 * matching the column type chosen by `arrowFieldToDuckDBType`.
 *
 * apache-arrow's `.get()` normalizes values per logical type: Timestamp and
 * Date come back as epoch milliseconds (number), Int64 as bigint, the rest as
 * their natural JS primitives.
 *
 * Date handling reads the column's `DateUnit` (DAY for Date32, MILLISECOND for
 * Date64) and converts to the day count DuckDB DATE stores. apache-arrow (v21)
 * normalizes BOTH units to epoch millis through the Date visitor on `.get()`,
 * so both divide by MS_PER_DAY — but keying on the unit makes that explicit and
 * keeps the branch honest if a future producer or arrow version surfaces raw
 * Date32 days. A Date32 round-trip test pins the behavior.
 */
function appendArrowValue(
  appender: DuckDBAppender,
  field: Field,
  value: unknown,
): void {
  if (value === null || value === undefined) {
    appender.appendNull();
    return;
  }
  arrowTypeAdapter(field).append(appender, value);
}

/**
 * Convert an apache-arrow Date `.get()` result to the day count DuckDB DATE
 * stores. In apache-arrow v21 the Date visitor normalizes both Date32 (DAY) and
 * Date64 (MILLISECOND) to epoch millis on read, so a single millis → days
 * conversion is correct for both units. Pinned by the Date32 round-trip test.
 */
function arrowDateToDuckDBDays(value: unknown): number {
  return Math.floor(Number(value) / MS_PER_DAY);
}
