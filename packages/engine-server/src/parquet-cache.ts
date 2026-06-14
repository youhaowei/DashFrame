/**
 * Stage 4 — Cache: on-disk Parquet, content-hash keyed.
 *
 * The physical cache the spec pins to the native path. Keyed by the compiled
 * `{ sql, params }` content hash (Stage 1) — definition changes change the
 * hash, so the key is self-isolating and carries no `draftId`.
 *
 * Every write threads through a single `CacheWriteGate.shouldWrite` seam, and
 * the gate is a REQUIRED constructor option — there is no fail-open default. The
 * sensitivity gate (#67) enforces the fail-closed rule: a result reaches the
 * on-disk Parquet file ONLY when every column is `cleared`. If the gate would
 * drop ANY column (a `sensitive`/`unclassified` column present, or a denied
 * result), the WHOLE result stays memory-only — it is uncacheable under the
 * full-query key, not partially written. A partial file under that key would
 * later be served as if complete, returning an incomplete schema instead of
 * re-reading the restricted columns from source (#89). `sensitive` and
 * `unclassified` columns thus only ever live in in-memory DuckDB and evaporate
 * on session close. No encryption is added; the protection is absence from
 * disk, not ciphertext.
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

import { quoteIdentifier, quoteLiteral } from "@dashframe/engine";
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
   * Decide whether a compiled query's result may be written to the on-disk
   * Parquet cache. Returns the cleared columns; `null`/empty means "do not write
   * to disk" (e.g. a fully-sensitive result stays memory-only).
   *
   * The returned column set is interpreted all-or-nothing by `ParquetCache`: if
   * it is missing ANY input column the whole result is uncacheable (a partial
   * file under the full-query key would later be served as complete — #89). The
   * gate need only report which columns are cleared; the cache decides cacheability.
   *
   * @param ctx.query   the compiled query whose result is being cached
   * @param ctx.columns result column names available to write
   * @returns the cleared columns; `null` to skip the disk write
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
   * Remove any existing on-disk Parquet file for this query.
   *
   * Called whenever a write is declined (deny, narrow, or duplicate-name
   * ambiguity) so a stale full-result file — written earlier when the columns
   * were cleared, or before the gate existed — cannot survive a reclassification
   * and keep `has(query)` reporting a hit. Fail toward NOT leaking: the cache
   * floor is "no restricted bytes on disk", so a stale file is treated as
   * untrusted and erased rather than left in place.
   */
  private async invalidate(query: CompiledQuery): Promise<void> {
    await fs.rm(this.pathFor(query), { force: true });
  }

  /**
   * Write a query's result to the Parquet cache via DuckDB's `COPY ... TO`,
   * threading the write through the gate. Returns the written path, or `null`
   * when the result is uncacheable (memory-only).
   *
   * The on-disk cache holds ONLY a complete, all-cleared result under
   * `pathFor(query)` — a hash of the FULL query. Anything less is uncacheable
   * and additionally invalidates any stale file already at that path:
   *
   *   - **Gate deny** (`null`/empty decision): the whole result stays
   *     memory-only (#67 — all columns restricted).
   *   - **Gate narrow** (decision drops ANY column): a partial result must NOT
   *     be written under the full-query key, or a later `has(query)` hit would
   *     return an INCOMPLETE schema instead of re-reading the restricted columns
   *     from source. A narrowed result is uncacheable — full result stays
   *     memory-only / re-read from source. Owner decision (#89).
   *   - **Duplicate column names**: the gate keys sensitivity by display name,
   *     so two columns named `id` (one cleared, one sensitive) collapse and the
   *     sensitive one could survive to disk. Duplicate names are ambiguous —
   *     fail closed and treat the whole result as uncacheable.
   *
   * In every uncacheable case the audit invariant ("zero restricted bytes on
   * disk") holds by construction: no COPY runs, and any stale file is erased.
   */
  async write(
    conn: DuckDBConnection,
    query: CompiledQuery,
    columns: string[],
  ): Promise<string | null> {
    // Duplicate result column names are ambiguous for the name-keyed gate — a
    // sensitive column can hide behind a cleared one sharing its name. Fail
    // closed: uncacheable, and erase any stale file under this key.
    if (new Set(columns).size !== columns.length) {
      await this.invalidate(query);
      return null;
    }

    const decision = this.gate.shouldWrite({ query, columns });
    // Gate denied the write entirely (all columns restricted).
    if (!decision || decision.columns.length === 0) {
      await this.invalidate(query);
      return null;
    }

    // Gate narrowed the result (dropped at least one column). A partial result
    // under the full-query key would later be served as if complete — skip the
    // disk write and erase any stale full-result file. Only an all-cleared,
    // complete result may be cached. Compared as sets: order is irrelevant.
    const writeSet = new Set(decision.columns);
    const narrowed =
      writeSet.size !== columns.length ||
      columns.some((col) => !writeSet.has(col));
    if (narrowed) {
      await this.invalidate(query);
      return null;
    }

    await fs.mkdir(this.cacheDir, { recursive: true });
    const target = this.pathFor(query);
    const selectList = decision.columns.map(quoteIdentifier).join(", ");
    // Bind the compiled query's positional params natively: DuckDB accepts the
    // `?` placeholders inside the COPY wrapper's inner SELECT and fills them from
    // `values`. This avoids text-scanning the SQL for `?` (which would also
    // rewrite question marks inside string literals/comments and corrupt the
    // query — e.g. `SELECT '?' AS marker, ? AS v`). By the time we reach here
    // the decision is a complete, all-cleared column set (narrowed results are
    // rejected above), so `selectList` is every result column.
    await conn.run(
      `COPY (SELECT ${selectList} FROM (${query.sql})) TO ${quoteLiteral(
        target,
      )} (FORMAT PARQUET)`,
      query.params as DuckDBValue[],
    );
    return target;
  }
}
