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
 *
 * `registerArrowTable` accepts an Arrow IPC stream buffer from the renderer,
 * decodes it with apache-arrow, writes each row as NDJSON to a temp file, and
 * ingests into an in-memory DuckDB table via `read_json_auto`. Chart-compute
 * queries work on aggregated results (small row counts), so the JSON round-trip
 * is acceptable for v1. Tables persist for the session lifetime and are
 * re-registered on reconnect.
 */
import type { DataFrame, QueryEngine, QueryResult } from "@dashframe/engine";
import type { TableColumn } from "@dashframe/types";
import {
  DuckDBInstance,
  type DuckDBConnection as Connection,
  type DuckDBValue,
} from "@duckdb/node-api";
import { tableFromIPC } from "apache-arrow";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
  /**
   * Set of table names currently registered via `registerArrowTable`. Used to
   * answer `hasTable`/`getTableNames` without an async DB round-trip.
   */
  private _registeredTables = new Set<string>();

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
   * Register an Arrow IPC stream buffer as a named in-memory DuckDB table.
   *
   * The renderer uploads each DataFrame's Arrow IPC buffer before issuing
   * chart-compute queries; the native engine then has the table available for
   * the duration of the session. On reconnect the renderer re-registers any
   * tables it needs.
   *
   * Implementation: decode with apache-arrow, serialize each row as NDJSON to
   * a temp file, then `CREATE OR REPLACE TABLE ... AS SELECT * FROM
   * read_json_auto(...)`. Chart queries run on aggregated/small datasets, so
   * the JSON round-trip is acceptable for v1.
   */
  async registerArrowTable(name: string, arrow: Uint8Array): Promise<void> {
    await this.initialize();
    const conn = this.conn();

    // Decode the Arrow IPC stream buffer.
    const arrowTable = tableFromIPC(arrow);
    const rowCount = arrowTable.numRows;

    // Serialize each row to NDJSON.
    const lines: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      const row: Record<string, unknown> = {};
      for (const field of arrowTable.schema.fields) {
        const col = arrowTable.getChild(field.name);
        // Apache-arrow column.get(i) returns the typed value.
        const val = col?.get(i);
        // Coerce BigInt to number (JSON can't serialize BigInt).
        row[field.name] = typeof val === "bigint" ? Number(val) : val;
      }
      lines.push(JSON.stringify(row));
    }

    // Write NDJSON to a temp file. Use a sanitised table name as part of the
    // filename so temp files are identifiable in crash dumps.
    const safe = name.replace(/[^a-z0-9_]/gi, "_").slice(0, 40);
    const tmpFile = path.join(os.tmpdir(), `df_${safe}_${Date.now()}.ndjson`);
    try {
      await fs.writeFile(tmpFile, lines.join("\n"), "utf8");
      const quotedPath = quoteLiteral(tmpFile);
      await conn.run(
        `CREATE OR REPLACE TABLE ${quoteIdent(name)} AS SELECT * FROM read_json_auto(${quotedPath})`,
      );
    } finally {
      // Best-effort cleanup — leave no temp files behind.
      await fs.unlink(tmpFile).catch(() => {});
    }

    this._registeredTables.add(name);
  }

  async registerTable(_name: string, _dataFrame: DataFrame): Promise<void> {
    throw new Error(
      "NativeDuckDBEngine.registerTable is not supported — upload Arrow IPC via registerArrowTable, or query sources directly (read_parquet)",
    );
  }

  async unregisterTable(name: string): Promise<void> {
    if (!this._registeredTables.has(name)) return;
    try {
      await this.conn().run(`DROP TABLE IF EXISTS ${quoteIdent(name)}`);
    } catch {
      // Best-effort; table may already be gone.
    }
    this._registeredTables.delete(name);
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
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
