/**
 * Stage 4 — Cache: on-disk Parquet, content-hash keyed.
 *
 * The physical cache the spec pins to the native path. Keyed by the compiled
 * `{ sql, params }` content hash (Stage 1) — definition changes change the
 * hash, so the key is self-isolating and carries no `draftId` (YW-128).
 *
 * Every write threads through a single `CacheWriteGate.shouldWrite` seam — the
 * explicit position where YW-130's sensitivity gate will plug in (sensitive
 * columns excluded from the on-disk write, in-memory DuckDB only). The gate
 * logic is OUT of scope for YW-151: this ships the pass-through gate
 * (`identityCacheWriteGate`) so the seam exists and is exercised, but every
 * write is currently allowed. The audit invariant the gate will enforce —
 * "grep the cache dir → zero sensitive bytes" — has its single chokepoint here.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { DuckDBConnection, DuckDBValue } from "@duckdb/node-api";

import type { CompiledQuery } from "./compile";
import { hashCompiledQuery } from "./compile";

/**
 * The cache-write gate seam. The single function every Parquet write passes
 * through. YW-130 replaces the pass-through implementation with the sensitivity
 * gate; the cache never writes around it.
 */
export interface CacheWriteGate {
  /**
   * Decide whether (and how) a compiled query's result may be written to the
   * on-disk Parquet cache. Returns the columns to persist — `null`/empty means
   * "do not write to disk" (e.g. a fully-sensitive result stays memory-only).
   *
   * @param ctx.query   the compiled query whose result is being cached
   * @param ctx.columns result column names available to write
   * @returns the subset of columns to persist; `null` to skip the disk write
   */
  shouldWrite(ctx: {
    query: CompiledQuery;
    columns: string[];
  }): { columns: string[] } | null;
}

/**
 * Pass-through gate: writes every result, all columns, to disk. The YW-151
 * default. YW-130 swaps in the sensitivity-aware gate behind this same
 * interface without touching the cache.
 */
export const identityCacheWriteGate: CacheWriteGate = {
  shouldWrite: ({ columns }) => ({ columns }),
};

export interface ParquetCacheOptions {
  /** Directory holding cached Parquet files (e.g. `<project>/data/cache`). */
  cacheDir: string;
  /**
   * The write-path gate. Defaults to pass-through (`identityCacheWriteGate`).
   * YW-130 supplies a sensitivity-aware gate here.
   */
  gate?: CacheWriteGate;
}

export class ParquetCache {
  private readonly cacheDir: string;
  private readonly gate: CacheWriteGate;

  constructor(options: ParquetCacheOptions) {
    this.cacheDir = options.cacheDir;
    this.gate = options.gate ?? identityCacheWriteGate;
  }

  /** Absolute Parquet path for a compiled query's content hash. */
  pathFor(query: CompiledQuery): string {
    return path.join(this.cacheDir, `${hashCompiledQuery(query)}.parquet`);
  }

  /** True if a fresh Parquet result is already on disk for this query. */
  has(query: CompiledQuery): boolean {
    return existsSync(this.pathFor(query));
  }

  /**
   * Write a query's result to the Parquet cache via DuckDB's `COPY ... TO`,
   * threading the write through the gate. Returns the written path, or `null`
   * when the gate declined the disk write (memory-only result).
   *
   * `columns` is the result's column set; the gate may narrow it (YW-130
   * excludes sensitive columns). When the gate returns no columns, nothing is
   * written — the audit invariant holds by construction.
   */
  async write(
    conn: DuckDBConnection,
    query: CompiledQuery,
    columns: string[],
  ): Promise<string | null> {
    const decision = this.gate.shouldWrite({ query, columns });
    if (!decision || decision.columns.length === 0) {
      return null;
    }

    await fs.mkdir(this.cacheDir, { recursive: true });
    const target = this.pathFor(query);
    const selectList = decision.columns.map(quoteIdent).join(", ");
    // Bind the compiled query's positional params natively: DuckDB accepts the
    // `?` placeholders inside the COPY wrapper's inner SELECT and fills them from
    // `values`. This avoids text-scanning the SQL for `?` (which would also
    // rewrite question marks inside string literals/comments and corrupt the
    // query — e.g. `SELECT '?' AS marker, ? AS v`). The gate's column narrowing
    // (the YW-130 seam) is unchanged — it still shapes `selectList`, the only
    // thing that decides what lands on disk.
    await conn.run(
      `COPY (SELECT ${selectList} FROM (${query.sql})) TO ${quoteLiteral(
        target,
      )} (FORMAT PARQUET)`,
      query.params as DuckDBValue[],
    );
    return target;
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
