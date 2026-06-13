import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashCompiledQuery, type CompiledQuery } from "./compile";
import {
  identityCacheWriteGate,
  makeSensitivityCacheWriteGate,
  ParquetCache,
  type CacheWriteGate,
} from "./parquet-cache";

/** Minimal fake connection: records the COPY statement it was asked to run. */
function fakeConn(): DuckDBConnection & { runs: string[] } {
  const runs: string[] = [];
  return {
    runs,
    run: vi.fn(async (sql: string) => {
      runs.push(sql);
    }),
  } as unknown as DuckDBConnection & { runs: string[] };
}

describe("ParquetCache — content-hash key + gate seam (Stage 4)", () => {
  let cacheDir: string;
  const query: CompiledQuery = { sql: "SELECT a, b FROM t", params: [] };

  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "df-cache-"));
  });
  afterEach(async () => {
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it("keys the on-disk path on the compiled-query content hash", () => {
    const cache = new ParquetCache({ cacheDir, gate: identityCacheWriteGate });
    expect(cache.pathFor(query)).toBe(
      path.join(cacheDir, `${hashCompiledQuery(query)}.parquet`),
    );
  });

  it("threads every write through the gate", async () => {
    const seen: { columns: string[] }[] = [];
    const gate: CacheWriteGate = {
      shouldWrite: (ctx) => {
        seen.push({ columns: ctx.columns });
        return { columns: ctx.columns };
      },
    };
    const cache = new ParquetCache({ cacheDir, gate });

    await cache.write(fakeConn(), query, ["a", "b"]);

    expect(seen).toEqual([{ columns: ["a", "b"] }]);
  });

  it("skips the disk write when the gate declines (memory-only)", async () => {
    const denyGate: CacheWriteGate = { shouldWrite: () => null };
    const cache = new ParquetCache({ cacheDir, gate: denyGate });
    const conn = fakeConn();

    const written = await cache.write(conn, query, ["a"]);

    expect(written).toBeNull();
    // The audit invariant: no COPY ran, so zero bytes reach disk.
    expect(conn.runs).toHaveLength(0);
  });

  it("a gate-narrowed result is uncacheable — no disk write under the full-query key", async () => {
    // Gate drops a sensitive column "b". A partial result under the full-query
    // key would later be served as complete (#89), so the whole result is
    // uncacheable: nothing is written, not just the narrowed subset.
    const narrowGate: CacheWriteGate = {
      shouldWrite: ({ columns }) => ({
        columns: columns.filter((c) => c !== "b"),
      }),
    };
    const cache = new ParquetCache({ cacheDir, gate: narrowGate });
    const conn = fakeConn();

    const written = await cache.write(conn, query, ["a", "b"]);

    expect(written).toBeNull();
    // No COPY ran — the partial column subset never reached disk.
    expect(conn.runs).toHaveLength(0);
  });

  it("duplicate result column names are uncacheable — fail closed, no disk write", async () => {
    // Two columns named "id": the name-keyed gate cannot tell a cleared "id"
    // from a sensitive one, so the sensitive column could hide behind the
    // cleared. Fail closed: the whole result is uncacheable.
    const cache = new ParquetCache({ cacheDir, gate: identityCacheWriteGate });
    const conn = fakeConn();

    const written = await cache.write(conn, query, ["id", "id"]);

    expect(written).toBeNull();
    expect(conn.runs).toHaveLength(0);
  });

  it("invalidates a stale on-disk file when a later write is denied", async () => {
    // A file exists at pathFor(query) — written earlier when columns were
    // cleared, or before the gate existed. A subsequent denied write must erase
    // it so has(query) cannot keep reporting a now-restricted hit.
    const target = path.join(cacheDir, `${hashCompiledQuery(query)}.parquet`);
    await fs.writeFile(target, "stale parquet bytes");

    const denyGate: CacheWriteGate = { shouldWrite: () => null };
    const cache = new ParquetCache({ cacheDir, gate: denyGate });

    expect(cache.has(query)).toBe(true);
    const written = await cache.write(fakeConn(), query, ["a"]);

    expect(written).toBeNull();
    // Stale file gone — has() no longer reports a hit, no stale bytes leak.
    expect(cache.has(query)).toBe(false);
  });

  it("invalidates a stale on-disk file when a later write is narrowed", async () => {
    // The reclassification case: a full result was cached when all columns were
    // cleared; a column later becomes sensitive, so the gate narrows. The stale
    // full-result file must be erased — not left to be served as complete.
    const target = path.join(cacheDir, `${hashCompiledQuery(query)}.parquet`);
    await fs.writeFile(target, "stale full-result parquet bytes");

    const narrowGate: CacheWriteGate = {
      shouldWrite: ({ columns }) => ({
        columns: columns.filter((c) => c !== "b"),
      }),
    };
    const cache = new ParquetCache({ cacheDir, gate: narrowGate });

    expect(cache.has(query)).toBe(true);
    const written = await cache.write(fakeConn(), query, ["a", "b"]);

    expect(written).toBeNull();
    expect(cache.has(query)).toBe(false);
  });

  it("an explicit identity gate writes all columns (opt-in pass-through)", async () => {
    const cache = new ParquetCache({ cacheDir, gate: identityCacheWriteGate });
    const conn = fakeConn();

    const written = await cache.write(conn, query, ["a", "b"]);

    expect(written).toBe(cache.pathFor(query));
    expect(conn.runs[0]).toContain('"a"');
    expect(conn.runs[0]).toContain('"b"');
  });

  it("identityCacheWriteGate allows all columns", () => {
    expect(
      identityCacheWriteGate.shouldWrite({ query, columns: ["x", "y"] }),
    ).toEqual({ columns: ["x", "y"] });
  });

  it("binds positional params natively — a literal '?' in the SQL is not corrupted", async () => {
    // Real DuckDB round-trip: the inner SELECT has a literal '?' in a string
    // AND a real placeholder. Text-scanning every '?' would consume the literal
    // as a placeholder and shift binding; native binding fills only the real
    // placeholder, so marker stays '?' and v binds to 42.
    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();
    try {
      const paramQuery: CompiledQuery = {
        sql: "SELECT '?' AS marker, ? AS v",
        params: [42],
      };
      const cache = new ParquetCache({
        cacheDir,
        gate: identityCacheWriteGate,
      });

      const written = await cache.write(conn, paramQuery, ["marker", "v"]);
      expect(written).toBe(cache.pathFor(paramQuery));

      const reader = await conn.runAndReadAll(
        `SELECT * FROM read_parquet(${quoteLiteralForTest(written!)})`,
      );
      const rows = reader.getRowObjectsJson();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.marker).toBe("?");
      expect(Number(rows[0]?.v)).toBe(42);
    } finally {
      conn.disconnectSync();
      // Close the instance too — it holds native handles and background
      // threads that outlive the connection and would leak past the suite.
      instance.closeSync();
    }
  });
});

/**
 * Sensitivity gate — observable behavior against the real cache dir.
 *
 * These tests use a real DuckDB instance and a real temp directory to assert
 * what lands on disk, not what arguments were passed to a mock. The contract
 * (all-or-nothing under the full-query key, #89):
 *   - An all-`cleared` result → written, full schema on disk
 *   - A MIXED result (any `sensitive`/`unclassified` column) → uncacheable,
 *     zero Parquet files written (not a narrowed partial file)
 *   - A result with only restricted columns → zero Parquet files written
 */
describe("makeSensitivityCacheWriteGate — fail-closed disk audit (Stage 4, #67)", () => {
  let cacheDir: string;
  let instance: InstanceType<typeof DuckDBInstance>;
  let conn: Awaited<ReturnType<InstanceType<typeof DuckDBInstance>["connect"]>>;

  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "df-sens-gate-"));
    instance = await DuckDBInstance.create(":memory:");
    conn = await instance.connect();
  });
  afterEach(async () => {
    conn.disconnectSync();
    instance.closeSync();
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it("an all-cleared result is written to disk with its full schema", async () => {
    // Every column is cleared — the result is cacheable and lands complete.
    const query: CompiledQuery = {
      sql: "SELECT 1 AS account_id, 2 AS region_id",
      params: [],
    };
    const gate = makeSensitivityCacheWriteGate(
      new Map([
        ["account_id", "cleared"],
        ["region_id", "cleared"],
      ]),
    );
    const cache = new ParquetCache({ cacheDir, gate });

    const written = await cache.write(conn, query, ["account_id", "region_id"]);

    expect(written).not.toBeNull();
    expect(written).toBe(cache.pathFor(query));

    const schemaReader = await conn.runAndReadAll(
      `DESCRIBE SELECT * FROM read_parquet(${quoteLiteralForTest(written!)})`,
    );
    const columnNames = schemaReader
      .getRowObjectsJson()
      .map((r) => (r as Record<string, unknown>)["column_name"] as string);

    expect(columnNames).toEqual(["account_id", "region_id"]);
  });

  it("a MIXED result (a sensitive/unclassified column present) is uncacheable — zero Parquet files written", async () => {
    // A result set with three columns of different sensitivity classes:
    //   account_id   → cleared   (safe to cache)
    //   email        → sensitive (must not reach disk)
    //   notes        → unclassified (fail-closed: treated as restricted)
    // Under #89 a partial file under the full-query key would later be served
    // as complete, so the whole result is uncacheable — nothing is written.
    const query: CompiledQuery = {
      sql: "SELECT 1 AS account_id, 'alice@example.com' AS email, 'some notes' AS notes",
      params: [],
    };
    const gate = makeSensitivityCacheWriteGate(
      new Map([
        ["account_id", "cleared"],
        ["email", "sensitive"],
        ["notes", "unclassified"],
      ]),
    );
    const cache = new ParquetCache({ cacheDir, gate });

    const written = await cache.write(conn, query, [
      "account_id",
      "email",
      "notes",
    ]);

    // No partial file — the mixed result stays memory-only.
    expect(written).toBeNull();
    expect(cache.has(query)).toBe(false);

    // Observable: the cache dir is empty — zero bytes reached disk.
    const files = await fs.readdir(cacheDir);
    expect(files).toHaveLength(0);
  });

  it("a result with only sensitive/unclassified columns produces zero Parquet files in the cache dir", async () => {
    // All columns are restricted — the gate should decline the entire write.
    const query: CompiledQuery = {
      sql: "SELECT 'alice@example.com' AS email, 'secret' AS password",
      params: [],
    };
    const gate = makeSensitivityCacheWriteGate(
      new Map([
        ["email", "sensitive"],
        // password absent from the map → defaults to unclassified (fail-closed)
      ]),
    );
    const cache = new ParquetCache({ cacheDir, gate });

    const written = await cache.write(conn, query, ["email", "password"]);

    // Gate returned null — no disk write.
    expect(written).toBeNull();

    // Observable: the cache dir is empty — zero bytes reached disk.
    const files = await fs.readdir(cacheDir);
    expect(files).toHaveLength(0);
  });

  it("a column absent from the sensitivity map defaults to unclassified (fail-closed), making the mixed result uncacheable", async () => {
    // Only one column is in the map (cleared); the other is unknown → defaults
    // to unclassified → restricted. The result is mixed, so it is uncacheable.
    const query: CompiledQuery = {
      sql: "SELECT 42 AS public_id, 'mystery' AS unknown_col",
      params: [],
    };
    const gate = makeSensitivityCacheWriteGate(
      new Map([["public_id", "cleared"]]),
      // unknown_col not in map → defaults to unclassified → restricted
    );
    const cache = new ParquetCache({ cacheDir, gate });

    const written = await cache.write(conn, query, [
      "public_id",
      "unknown_col",
    ]);

    expect(written).toBeNull();
    const files = await fs.readdir(cacheDir);
    expect(files).toHaveLength(0);
  });
});

/** Mirror production's `quoteLiteral` quoting discipline in test SQL. */
function quoteLiteralForTest(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
