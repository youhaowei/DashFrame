/**
 * Stage 3 — Execute: the native DuckDB engine.
 *
 * A second `QueryEngine` implementation (alongside the renderer's DuckDB-WASM)
 * that runs in the loopback server process on Electron desktop. It owns one
 * DuckDB connection; the renderer cannot tell local from remote, and the cloud
 * tier will reuse this exact seam.
 *
 * Beyond the row-shaped `QueryEngine.query`, it exposes `queryArrow` — the
 * Arrow IPC bytes the dedicated data path (Stage 5) streams. Arrow encoding is
 * delegated to `apache-arrow` (`resultToArrowIpc`) rather than DuckDB's Arrow
 * extension, so the binary format matches exactly what DuckDB-WASM ingests on
 * the renderer side and stays in one well-exercised library.
 */
import type { DataFrame, QueryEngine, QueryResult } from "@dashframe/engine";
import type { TableColumn } from "@dashframe/types";
import {
  DuckDBInstance,
  type DuckDBConnection as Connection,
  type DuckDBValue,
} from "@duckdb/node-api";

import {
  duckdbColumnsToArrowIpc,
  duckdbTypeIdToColumnType,
  type ResultColumn,
} from "./arrow-encode";

export interface NativeDuckDBEngineOptions {
  /**
   * DuckDB database path. Default `:memory:` — an in-memory database.
   *
   * The cache-write gate (see #67) keeps sensitive columns memory-only by
   * excluding them from the on-disk Parquet cache (Stage 4); the engine's own
   * working database is in-memory by default so a session leaves nothing at
   * rest unless a query is explicitly cached.
   */
  databasePath?: string;
}

export class NativeDuckDBEngine implements QueryEngine {
  private readonly databasePath: string;
  private instance: DuckDBInstance | null = null;
  private connection: Connection | null = null;
  /**
   * Memoized in-flight initialization. The first caller installs the promise;
   * concurrent callers await the SAME one instead of each racing to create a
   * second `DuckDBInstance` (which would leak the loser's native handle,
   * background threads, and any file lock on the database path).
   */
  private initPromise: Promise<void> | null = null;

  constructor(options: NativeDuckDBEngineOptions = {}) {
    this.databasePath = options.databasePath ?? ":memory:";
  }

  async initialize(): Promise<void> {
    if (this.connection) return;
    // Guard against concurrent initialize() calls: the `await` below yields the
    // event loop, so a plain `if (this.connection)` check (which is null until
    // both awaits resolve) would let two callers both create an instance. Latch
    // the first call's promise and hand it to everyone else.
    this.initPromise ??= (async () => {
      const instance = await DuckDBInstance.create(this.databasePath);
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
    const reader =
      params.length > 0
        ? await this.conn().runAndReadAll(sql, params as DuckDBValue[])
        : await this.conn().runAndReadAll(sql);
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

  /**
   * The native engine is the *producer* of result Arrow, not a consumer: per
   * the pipeline spec, ingesting result Arrow as a transient table is the
   * renderer-side DuckDB-WASM's narrowed role, while the native engine reads
   * its sources directly (`read_parquet` / `postgres_scan`). Arrow-buffer
   * registration is therefore intentionally unsupported here — kept explicit
   * (throws) rather than a silent no-op so the contract is visible.
   */
  async registerArrowTable(_name: string, _arrow: Uint8Array): Promise<void> {
    throw new Error(
      "NativeDuckDBEngine.registerArrowTable is not supported — Arrow ingest is the renderer WASM engine's role; query sources directly here",
    );
  }

  async registerTable(_name: string, _dataFrame: DataFrame): Promise<void> {
    throw new Error(
      "NativeDuckDBEngine.registerTable is not supported — query sources directly (read_parquet / postgres_scan)",
    );
  }

  async unregisterTable(_name: string): Promise<void> {
    // No-op: this engine registers no named tables.
  }

  hasTable(_name: string): boolean {
    return false;
  }

  getTableNames(): string[] {
    return [];
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
}
