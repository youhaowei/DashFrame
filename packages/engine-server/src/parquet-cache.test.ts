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

  it("writes only the gate-narrowed column subset (sensitivity-gate seam)", async () => {
    // Gate excludes a sensitive column "b" — only "a" reaches the COPY.
    const narrowGate: CacheWriteGate = {
      shouldWrite: ({ columns }) => ({
        columns: columns.filter((c) => c !== "b"),
      }),
    };
    const cache = new ParquetCache({ cacheDir, gate: narrowGate });
    const conn = fakeConn();

    await cache.write(conn, query, ["a", "b"]);

    expect(conn.runs).toHaveLength(1);
    expect(conn.runs[0]).toContain('"a"');
    expect(conn.runs[0]).not.toContain('"b"');
    expect(conn.runs[0]).toContain("FORMAT PARQUET");
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
        `SELECT * FROM read_parquet('${written}')`,
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
 * what lands on disk, not what arguments were passed to a mock. The contract:
 *   - `cleared` columns → present in the on-disk Parquet schema
 *   - `sensitive` columns → absent from every file in the cache dir
 *   - `unclassified` columns → absent from every file in the cache dir (fail-closed)
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

  it("cleared columns are written to disk; sensitive and unclassified columns are absent from every cached file", async () => {
    // A result set with three columns of different sensitivity classes:
    //   account_id   → cleared   (safe to cache)
    //   email        → sensitive (must not reach disk)
    //   notes        → unclassified (fail-closed: treated as restricted)
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

    // A file was written (the cleared column survived the gate).
    expect(written).not.toBeNull();
    expect(written).toBe(cache.pathFor(query));

    // Read the Parquet schema back via DuckDB — column names are the ground truth.
    const schemaReader = await conn.runAndReadAll(
      `DESCRIBE SELECT * FROM read_parquet('${written}')`,
    );
    const columnNames = schemaReader
      .getRowObjectsJson()
      .map((r) => (r as Record<string, unknown>)["column_name"] as string);

    // Only the cleared column is on disk.
    expect(columnNames).toContain("account_id");
    // Sensitive column is absent — audit invariant: zero sensitive bytes on disk.
    expect(columnNames).not.toContain("email");
    // Unclassified column is absent — fail-closed: default is restricted.
    expect(columnNames).not.toContain("notes");
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

  it("a column absent from the sensitivity map defaults to unclassified (fail-closed) and is excluded from disk", async () => {
    // Only one column is in the map (cleared); the other is unknown.
    const query: CompiledQuery = {
      sql: "SELECT 42 AS public_id, 'mystery' AS unknown_col",
      params: [],
    };
    const gate = makeSensitivityCacheWriteGate(
      new Map([["public_id", "cleared"]]),
      // unknown_col not in map → defaults to unclassified → excluded
    );
    const cache = new ParquetCache({ cacheDir, gate });

    const written = await cache.write(conn, query, [
      "public_id",
      "unknown_col",
    ]);

    expect(written).not.toBeNull();

    const schemaReader = await conn.runAndReadAll(
      `DESCRIBE SELECT * FROM read_parquet('${written}')`,
    );
    const columnNames = schemaReader
      .getRowObjectsJson()
      .map((r) => (r as Record<string, unknown>)["column_name"] as string);

    expect(columnNames).toContain("public_id");
    expect(columnNames).not.toContain("unknown_col");
  });
});
