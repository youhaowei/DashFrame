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

export class NativeDuckDBEngine implements QueryEngine {
  private readonly sandboxLimits: NativeDuckDBEngineOptions["sandboxLimits"];
  private readonly databasePath: string;
  private readonly restrictFileAccess: boolean;
  private instance: DuckDBInstance | null = null;
  private connection: Connection | null = null;
  /**
   * Memoized in-flight initialization. The first caller installs the promise;
   * concurrent callers await the SAME one instead of each racing to create a
   * second `DuckDBInstance` (which would leak the loser's native handle,
   * background threads, and any file lock on the database path).
   */
  private initPromise: Promise<void> | null = null;
  /**
   * Set of table names currently registered via `registerArrowTable`. Used to
   * answer `hasTable`/`getTableNames` without an async DB round-trip.
   */
  private _registeredTables = new Set<string>();
  /**
   * Global serializer for `registerArrowTable`. DuckDB appenders are not
   * concurrent-safe on a shared connection — two in-flight registrations sharing
   * `this.connection` can trigger the "pending-result" NAPI taint that kills the
   * next operation on the connection.
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
  private lifecycleAbort = new AbortController();
  private activeNativeOperations = 0;
  private operationsIdle: Promise<void> | null = null;
  private resolveOperationsIdle: (() => void) | null = null;
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
    if (this.connection) return;
    // Disposal is terminal. Re-arming the lifecycle controller here would let
    // any initialize() caller resurrect a disposed engine: dispose() nulls the
    // connection, so this method would build a fresh DuckDBInstance and
    // connection that the owner — which already disposed — will never close,
    // leaking a native handle, its background threads, and any file lock on a
    // non-:memory: path. Failing closed at this single chokepoint covers every
    // entry point rather than each one re-deriving the check.
    throwIfAborted(this.lifecycleAbort.signal);
    // Guard against concurrent initialize() calls: the `await` below yields the
    // event loop, so a plain `if (this.connection)` check (which is null until
    // both awaits resolve) would let two callers both create an instance. Latch
    // the first call's promise and hand it to everyone else.
    this.initPromise ??= (async () => {
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
      this.instance = instance;
      this.connection = connection;
    })();
    try {
      await this.initPromise;
    } catch (err) {
      // A failed init must not be cached — clear the latch so a later call can
      // retry rather than re-await a permanently-rejected promise.
      this.initPromise = null;
      throw err;
    }
  }

  isReady(): boolean {
    return this.connection !== null;
  }

  private conn(): Connection {
    if (!this.connection) {
      throw new Error(
        "NativeDuckDBEngine not initialized — call initialize() first",
      );
    }
    return this.connection;
  }

  async query(sql: string): Promise<QueryResult> {
    const reader = await this.conn().runAndReadAll(sql);
    const columnNames = reader.columnNames();
    const columnTypes = reader.columnTypes();
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];

    const columns: TableColumn[] = columnNames.map((name, i) => ({
      name,
      type: duckdbTypeIdToColumnType(columnTypes[i]?.typeId),
    }));

    return { columns, rows, rowCount: rows.length };
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
    const values = params.length > 0 ? (params as DuckDBValue[]) : undefined;
    const reader = this.sandboxLimits
      ? await this.conn().runAndReadUntil(
          sql,
          this.sandboxLimits.maxResultRows + 1,
          values,
        )
      : await this.conn().runAndReadAll(sql, values);
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
  }

  queryArrowBatches(
    sql: string,
    params: readonly unknown[] = [],
    signal?: AbortSignal,
  ): AsyncIterable<Uint8Array> {
    const lifecycleSignal = this.lifecycleAbort.signal;
    const iterator = this.queryArrowBatchGenerator(
      sql,
      params,
      signal,
      lifecycleSignal,
      () => this.activeQueryIterators.add(iterator),
      () => this.activeQueryIterators.delete(iterator),
    );
    return iterator;
  }

  private async *queryArrowBatchGenerator(
    sql: string,
    params: readonly unknown[],
    signal: AbortSignal | undefined,
    lifecycleSignal: AbortSignal,
    onStarted: () => void,
    onClosed: () => void,
  ): AsyncGenerator<Uint8Array> {
    let operationSignal: AbortSignal | undefined;
    let connection: Connection | undefined;
    let interrupt: (() => void) | undefined;
    onStarted();
    try {
      throwIfAborted(lifecycleSignal);
      await this.initialize();
      throwIfAborted(lifecycleSignal);
      throwIfAborted(signal);
      operationSignal = this.beginNativeOperation(signal);
      connection = await this.instance!.connect();
      interrupt = () => connection!.interrupt();
      operationSignal.addEventListener("abort", interrupt, { once: true });
      throwIfAborted(operationSignal);
      const result =
        params.length > 0
          ? await connection.stream(sql, params as DuckDBValue[])
          : await connection.stream(sql);
      const names = result.columnNames();
      const types = result.columnTypes();
      let yielded = false;
      let rowCount = 0;
      while (true) {
        throwIfAborted(operationSignal);
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
      throwIfAborted(operationSignal);
    } finally {
      if (interrupt) operationSignal?.removeEventListener("abort", interrupt);
      connection?.disconnectSync();
      if (operationSignal) this.endNativeOperation();
      onClosed();
    }
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

    // Serialize all registrations through a global promise-chain lock. DuckDB
    // appenders are not concurrent-safe on a shared connection — two in-flight
    // registrations both using `this.connection` can trigger the Linux
    // "pending-result" NAPI taint on the shared connection, corrupting the
    // next operation on the connection. Global (not per-name): the taint is
    // per-connection, not per-table, so two different-name concurrent uploads
    // race just as badly.
    const gate = this._registrationLock;
    let unlock!: () => void;
    this._registrationLock = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await gate;

    try {
      const conn = this.conn();
      // Decode the Arrow IPC stream buffer.
      const arrowTable = tableFromIPC(arrow);
      const fields = arrowTable.schema.fields;
      if (fields.length === 0) {
        throw new Error(`Arrow buffer for table "${name}" has no columns`);
      }

      // Create a session-scoped TEMP table for staging — if the append fails
      // partway through, the live table is untouched (atomic all-or-nothing).
      // TEMP tables are connection-local: DuckDB drops them automatically when
      // the owning connection closes. On the success path, the explicit DROP after
      // the swap keeps stale staging tables from accumulating across repeated
      // registerArrowTable calls. On the failure path, the catch block disconnects
      // and replaces this.connection, so the staging table is dropped then too.
      //
      // The staging name carries a per-call unique suffix so that the
      // intermediate per-table catalog entry is distinct per upload even though
      // only one registration runs at a time (the suffix is still useful if the
      // same engine is ever queried while a registration is in-flight, and it
      // documents intent clearly).
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
        // On Linux, duckdb_appender_close() on a failed appender marks the
        // connection with a pending-result error. The next duckdb_query() on the
        // same connection fails with "Attempting to execute an unsuccessful or
        // closed pending query result" — emitted as an unhandled NAPI-layer
        // rejection that bypasses the surrounding try/catch.
        //
        // `conn` is `this.connection` — the PERSISTENT connection reused for the
        // whole session (query, queryArrow, registerArrowTable). Leaving it tainted
        // relocates the flake to the NEXT operation instead of killing it.
        //
        // Fix: disconnect the tainted connection and replace it with a fresh one
        // from the same instance. When the old connection closes, DuckDB drops all
        // its TEMP tables — including the partial staging table — so the cleanup
        // also happens for free.
        try {
          this.connection!.disconnectSync();
        } catch {
          // best-effort — continue to reconnect even if disconnect throws
        }
        this.connection = null;
        try {
          // No need to re-apply the access restrictions here: they belong to
          // the instance, not to this connection, and are already locked.
          this.connection = await this.instance!.connect();
        } catch {
          // Reconnect failed — engine is unusable; surface on next call via conn()
        }
        throw err;
      }
      // Flush succeeded — close the appender before the swap.
      try {
        appender.closeSync();
      } catch {
        // close failure after a successful flush must not abort the swap
      }

      // Atomic swap: replace the live table with the fully-ingested staging copy.
      // Both DDL statements run in the same connection, so the live table is never
      // observable in a half-replaced state.
      await conn.run(
        `CREATE OR REPLACE TABLE ${quoteIdent(name)} AS SELECT * FROM ${quoteIdent(stagingName)}`,
      );
      await conn.run(`DROP TABLE IF EXISTS ${quoteIdent(stagingName)}`);

      this._registeredTables.add(name);
    } finally {
      unlock();
    }
  }

  async registerArrowStream(
    name: string,
    rawIPCStream: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<void> {
    const lifecycleSignal = this.lifecycleAbort.signal;
    throwIfAborted(lifecycleSignal);
    await this.initialize();
    throwIfAborted(lifecycleSignal);
    throwIfAborted(signal);
    const operationSignal = this.beginNativeOperation(signal);

    const gate = this._registrationLock;
    let unlock!: () => void;
    this._registrationLock = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await gate;

    try {
      const conn = await this.instance!.connect();
      const interrupt = () => conn.interrupt();
      operationSignal.addEventListener("abort", interrupt, { once: true });
      try {
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
              // Disconnect below discards this connection and its TEMP state.
            }
          }
        }
      } finally {
        operationSignal.removeEventListener("abort", interrupt);
        conn.disconnectSync();
      }
    } finally {
      unlock();
      this.endNativeOperation();
    }
  }

  async registerTable(_name: string, _dataFrame: DataFrame): Promise<void> {
    throw new Error(
      "NativeDuckDBEngine.registerTable is not supported — upload Arrow IPC via registerArrowTable, or query sources directly (read_parquet)",
    );
  }

  async unregisterTable(name: string): Promise<void> {
    await this.initialize();
    const gate = this._registrationLock;
    let unlock!: () => void;
    this._registrationLock = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await gate;
    try {
      if (!this._registeredTables.has(name)) return;
      await this.conn().run(`DROP TABLE IF EXISTS ${quoteIdent(name)}`);
      // Forget the registration only after DuckDB confirms the DROP. A
      // transient native failure must leave the entry discoverable so cleanup
      // can retry instead of leaking a table the registry claims is gone.
      this._registeredTables.delete(name);
    } finally {
      unlock();
    }
  }

  hasTable(name: string): boolean {
    return this._registeredTables.has(name);
  }

  getTableNames(): string[] {
    return [...this._registeredTables];
  }

  async dispose(): Promise<void> {
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
    this.lifecycleAbort.abort(
      new DOMException("NativeDuckDBEngine disposed", "AbortError"),
    );
    const activeQueries = [...this.activeQueryIterators];
    await Promise.allSettled(
      activeQueries.map((iterator) => iterator.return(undefined)),
    );
    for (const iterator of activeQueries)
      this.activeQueryIterators.delete(iterator);
    await this.operationsIdle;
    this._registeredTables.clear();
    // Disconnect the connection before closing the instance — DuckDB expects
    // all connections to be released before the instance is closed.
    this.connection?.disconnectSync();
    this.connection = null;
    // Close the native instance: releases the background I/O threads, the
    // file lock on the database path, and any native heap the instance holds.
    // The init-failure path already calls closeSync() inline; tolerating an
    // already-closed instance here makes dispose() idempotent (double-dispose
    // is safe by design — e.g. both a finally-block and an afterEach teardown
    // calling dispose() on the same engine must not throw).
    try {
      this.instance?.closeSync();
    } catch {
      // Already closed — safe to ignore.
    }
    this.instance = null;
    this.initPromise = null;
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
