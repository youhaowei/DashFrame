/**
 * Stage 4 — Cache: on-disk Parquet, content-hash keyed.
 *
 * The physical cache the spec pins to the native path. Keyed by the compiled
 * `{ sql, params }` content hash (Stage 1) — definition changes change the
 * hash, so the key is self-isolating and carries no `draftId`.
 *
 * Every write threads through a single `CacheWriteGate.shouldWrite` seam, and
 * the gate is a REQUIRED constructor option — there is no fail-open default. The
 * sensitivity gate (#67) enforces the fail-closed rule: only `cleared` columns
 * reach the on-disk Parquet file. `sensitive` and `unclassified` columns are
 * memory-only — they load into in-memory DuckDB and evaporate on session close.
 * No encryption is added; the protection is absence from disk, not ciphertext.
 *
 * Writing every column to disk (the public/cleared-only path) is possible but
 * must be opted into EXPLICITLY by passing `identityCacheWriteGate` — the unsafe
 * choice is greppable, never the silent default.
 *
 * Accepted cost: restricted columns re-read from source each session; disk-spill
 * is unavailable for them.
 *
 * Audit invariant: "inspect the cache dir → zero bytes belonging to sensitive
 * or unclassified columns" holds by construction — every write passes through
 * `makeSensitivityCacheWriteGate`, which is the single chokepoint.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { FieldSensitivity } from "@dashframe/types";
import type { DuckDBConnection, DuckDBValue } from "@duckdb/node-api";

import type { CompiledQuery } from "./compile";
import { hashCompiledQuery } from "./compile";

/**
 * The cache-write gate seam. The single function every Parquet write passes
 * through. Issue #67 replaces the pass-through implementation with the sensitivity
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
 * Pass-through gate: writes every result, all columns, to disk. Suitable for
 * contexts where all data is known-cleared (e.g. a test fixture with synthetic
 * non-sensitive data, or the public/cleared-only path).
 *
 * The gate is a required `ParquetCache` option with no default, so a caller that
 * wants everything on disk must pass this EXPLICITLY — making the unsafe choice
 * visible and greppable. For production use, prefer `makeSensitivityCacheWriteGate`.
 */
export const identityCacheWriteGate: CacheWriteGate = {
  shouldWrite: ({ columns }) => ({ columns }),
};

/**
 * Sensitivity-aware cache-write gate (#67).
 *
 * Enforces the fail-closed rule: a column is written to the on-disk Parquet
 * cache ONLY if its sensitivity is explicitly `cleared`. Both `sensitive` and
 * `unclassified` are treated as restricted — they stay in memory-only DuckDB
 * and evaporate on session close.
 *
 * Columns absent from `columnSensitivity` default to `unclassified` (the
 * fail-closed invariant from `Field.sensitivity`).
 *
 * When the filtered set is empty (all columns are restricted), `shouldWrite`
 * returns `null` — the whole disk write is skipped, not just individual columns.
 *
 * @param columnSensitivity - Map from result column name to its `FieldSensitivity`.
 *   Pass only what you know; unknowns are restricted by default.
 */
export function makeSensitivityCacheWriteGate(
  columnSensitivity: ReadonlyMap<string, FieldSensitivity>,
): CacheWriteGate {
  return {
    shouldWrite({ columns }) {
      const cleared = columns.filter(
        (col) => (columnSensitivity.get(col) ?? "unclassified") === "cleared",
      );
      if (cleared.length === 0) return null;
      return { columns: cleared };
    },
  };
}

export interface ParquetCacheOptions {
  /** Directory holding cached Parquet files (e.g. `<project>/data/cache`). */
  cacheDir: string;
  /**
   * The write-path gate. REQUIRED — there is no default. A fail-closed value
   * behind a fail-open default is only as safe as every future caller
   * remembering to pass it; making the gate mandatory keeps the cache
   * secure-by-construction. Production callers pass `makeSensitivityCacheWriteGate`
   * (#67). A caller that genuinely wants every column on disk (the
   * public/cleared-only path) must opt into pass-through EXPLICITLY by passing
   * `identityCacheWriteGate` — the unsafe choice is visible and greppable, never
   * the silent default.
   */
  gate: CacheWriteGate;
}

export class ParquetCache {
  private readonly cacheDir: string;
  private readonly gate: CacheWriteGate;

  constructor(options: ParquetCacheOptions) {
    this.cacheDir = options.cacheDir;
    this.gate = options.gate;
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
   * `columns` is the result's column set; the gate may narrow it (see #67
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
    // (the sensitivity-gate seam, see #67) is unchanged — it still shapes `selectList`, the only
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
