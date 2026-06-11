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
} from "@duckdb/node-api";

import { duckdbColumnsToArrowIpc, type ResultColumn } from "./arrow-encode";

export interface NativeDuckDBEngineOptions {
  /**
   * DuckDB database path. Default `:memory:` — an in-memory database.
   *
   * The cache-write gate (YW-130) keeps sensitive columns memory-only by
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

  constructor(options: NativeDuckDBEngineOptions = {}) {
    this.databasePath = options.databasePath ?? ":memory:";
  }

  async initialize(): Promise<void> {
    if (this.connection) return;
    this.instance = await DuckDBInstance.create(this.databasePath);
    this.connection = await this.instance.connect();
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
      type: String(columnTypes[i]?.typeId ?? "unknown"),
    }));

    return { columns, rows, rowCount: rows.length };
  }

  /**
   * Execute `sql` and return the result as an Arrow IPC stream buffer — the
   * payload the data path (Stage 5) serves as
   * `application/vnd.apache.arrow.stream`.
   */
  async queryArrow(sql: string): Promise<Uint8Array> {
    const reader = await this.conn().runAndReadAll(sql);
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
    this.connection?.disconnectSync();
    this.connection = null;
    this.instance = null;
  }
}
