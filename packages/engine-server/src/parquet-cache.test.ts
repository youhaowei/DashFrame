import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { DuckDBConnection } from "@duckdb/node-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashCompiledQuery, type CompiledQuery } from "./compile";
import {
  identityCacheWriteGate,
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
    const cache = new ParquetCache({ cacheDir });
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

  it("writes only the gate-narrowed column subset (YW-130 seam)", async () => {
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

  it("default gate is pass-through (writes all columns)", async () => {
    const cache = new ParquetCache({ cacheDir });
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
});
