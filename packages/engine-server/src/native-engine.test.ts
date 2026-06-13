import {
  Bool,
  Float64,
  Table,
  tableFromIPC,
  tableToIPC,
  TimestampMillisecond,
  Utf8,
  vectorFromArray,
} from "apache-arrow";
import fs from "node:fs/promises";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { NativeDuckDBEngine } from "./native-engine";

const MS_PER_HOUR = 3_600_000;

describe("NativeDuckDBEngine — real native DuckDB (Stage 3)", () => {
  let engine: NativeDuckDBEngine | null = null;

  afterEach(async () => {
    await engine?.dispose();
    engine = null;
  });

  it("is not ready until initialized", () => {
    engine = new NativeDuckDBEngine();
    expect(engine.isReady()).toBe(false);
  });

  it("executes a SQL query and returns rows", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    expect(engine.isReady()).toBe(true);

    const result = await engine.query(
      "SELECT range AS n FROM range(3) ORDER BY n",
    );
    expect(result.rowCount).toBe(3);
    expect(result.columns.map((c) => c.name)).toEqual(["n"]);
    expect(result.rows.map((r) => Number(r.n))).toEqual([0, 1, 2]);
  });

  it("query() returns normalized column types, not raw DuckDB type ids", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    // Same normalization the Arrow path (queryArrow → arrow-encode) applies:
    // semantic ColumnType names, never numeric DuckDB type-id strings. A caller
    // branching on column.type must see "number"/"string", not "4"/"17".
    const result = await engine.query(
      "SELECT 1::int AS i, 'a' AS s, 1.5::double AS d",
    );
    expect(result.columns).toEqual([
      { name: "i", type: "number" },
      { name: "s", type: "string" },
      { name: "d", type: "number" },
    ]);
  });

  it("does not corrupt a literal '?' when binding positional params (native binding, not text scan)", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    // A literal question mark in a string AND a real placeholder. Text-scanning
    // every `?` would consume the literal as a placeholder and shift binding,
    // corrupting both columns. Native binding only fills the real placeholder.
    const ipc = await engine.queryArrow("SELECT '?' AS marker, ? AS v", [42]);
    const table = tableFromIPC(ipc);

    expect(table.numRows).toBe(1);
    expect(table.getChild("marker")?.toArray()).toEqual(["?"]);
    expect([...table.getChild("v")!.toArray()].map(Number)).toEqual([42]);
  });

  it("is not usable after dispose()", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();
    expect(engine.isReady()).toBe(true);

    await engine.dispose();

    // isReady() must return false — the connection reference is gone.
    expect(engine.isReady()).toBe(false);
    // query() must throw rather than silently return empty results, so callers
    // discover the misuse instead of seeing a ghost success.
    await expect(engine.query("SELECT 1")).rejects.toThrow(
      "NativeDuckDBEngine not initialized",
    );
  });

  it("dispose() is idempotent — calling it twice does not throw", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    // First dispose closes connection + instance.
    await engine.dispose();
    // Second dispose must not throw even though handles are already gone —
    // e.g. a finally-block and an afterEach teardown may both call dispose().
    await expect(engine.dispose()).resolves.toBeUndefined();
    expect(engine.isReady()).toBe(false);
  });

  it("dispose() on an uninitialized engine does not throw", async () => {
    engine = new NativeDuckDBEngine();
    // Never called initialize() — nothing to close, must be a no-op.
    await expect(engine.dispose()).resolves.toBeUndefined();
  });

  it("dispose() during an in-flight initialize() leaves the engine dead, not live", async () => {
    engine = new NativeDuckDBEngine();
    // dispose() races initialize(): without awaiting the init latch, the init
    // closure would assign a live connection AFTER teardown ran — an engine
    // alive past disposal (e.g. Electron before-quit during DuckDB startup).
    const init = engine.initialize();
    await engine.dispose();
    await init;

    expect(engine.isReady()).toBe(false);
    await expect(engine.query("SELECT 1")).rejects.toThrow(
      "NativeDuckDBEngine not initialized",
    );
  });

  it("is idempotent under concurrent initialize() — one connection, no leaked instance", async () => {
    engine = new NativeDuckDBEngine();
    // Two callers race before the first await resolves; both must converge on
    // the same connection rather than each creating a DuckDBInstance.
    await Promise.all([engine.initialize(), engine.initialize()]);
    expect(engine.isReady()).toBe(true);

    // A query still works on the single surviving connection.
    const result = await engine.query("SELECT 1 AS one");
    expect(result.rows.map((r) => Number(r.one))).toEqual([1]);
  });

  it("produces Arrow IPC that roundtrips through apache-arrow", async () => {
    engine = new NativeDuckDBEngine();
    await engine.initialize();

    const ipc = await engine.queryArrow(
      "SELECT range::int AS id, ('row' || range) AS label FROM range(3)",
    );
    const table = tableFromIPC(ipc);

    expect(table.numRows).toBe(3);
    expect(table.schema.fields.map((f) => f.name)).toEqual(["id", "label"]);
    expect([...table.getChild("id")!.toArray()].map(Number)).toEqual([0, 1, 2]);
    expect(table.getChild("label")?.toArray()).toEqual([
      "row0",
      "row1",
      "row2",
    ]);
  });

  describe("registerArrowTable — in-memory Arrow ingest", () => {
    /**
     * Build an Arrow IPC buffer the same way the renderer's producer does
     * (engine-browser createArrowIPCBufferFromRows): Float64 / Bool /
     * TimestampMillisecond / Utf8 columns.
     */
    function producerBuffer(): Uint8Array {
      const ts = Date.UTC(2026, 0, 15, 12, 30, 0); // 2026-01-15T12:30:00Z
      return tableToIPC(
        new Table({
          amount: vectorFromArray([10.5, null, 33.25], new Float64()),
          active: vectorFromArray([true, false, null], new Bool()),
          created: vectorFromArray(
            [ts, null, ts + MS_PER_HOUR],
            new TimestampMillisecond(),
          ),
          label: vectorFromArray(["a", "b", null], new Utf8()),
        }),
      );
    }

    it("registers a table that is queryable with exact values and nulls", async () => {
      engine = new NativeDuckDBEngine();
      await engine.registerArrowTable("df_test", producerBuffer());

      const result = await engine.query(
        'SELECT amount, active, label FROM "df_test" ORDER BY amount NULLS LAST',
      );
      expect(result.rowCount).toBe(3);
      expect(result.rows[0]).toMatchObject({
        amount: 10.5,
        active: true,
        label: "a",
      });
      expect(result.rows[1]).toMatchObject({ amount: 33.25, label: null });
      expect(result.rows[2]).toMatchObject({ amount: null, label: "b" });
    });

    it("preserves timestamps as native TIMESTAMP, not strings (type fidelity)", async () => {
      engine = new NativeDuckDBEngine();
      await engine.registerArrowTable("df_ts", producerBuffer());

      // typeof() proves the column landed as TIMESTAMP — a JSON round-trip
      // would have degraded it to VARCHAR. epoch_ms proves value fidelity.
      const result = await engine.query(
        `SELECT typeof(created) AS t, epoch_ms(created) AS ms
         FROM "df_ts" WHERE created IS NOT NULL ORDER BY created`,
      );
      expect(result.rows.map((r) => r.t)).toEqual(["TIMESTAMP", "TIMESTAMP"]);
      const ts = Date.UTC(2026, 0, 15, 12, 30, 0);
      expect(result.rows.map((r) => Number(r.ms))).toEqual([
        ts,
        ts + MS_PER_HOUR,
      ]);
    });

    it("never writes row data to the filesystem (privacy floor)", async () => {
      // The old implementation staged rows as an NDJSON temp file. The privacy
      // floor forbids row data at rest outside the gated cache — pin the
      // in-memory contract by checking no staging file appears in tmpdir.
      engine = new NativeDuckDBEngine();
      await engine.registerArrowTable("df_privacy_probe", producerBuffer());

      const tmpEntries = await fs.readdir(os.tmpdir());
      expect(tmpEntries.filter((f) => f.includes("df_privacy_probe"))).toEqual(
        [],
      );
    });

    it("tracks registered tables and unregisters cleanly", async () => {
      engine = new NativeDuckDBEngine();
      await engine.registerArrowTable("df_tracked", producerBuffer());
      expect(engine.hasTable("df_tracked")).toBe(true);
      expect(engine.getTableNames()).toContain("df_tracked");

      await engine.unregisterTable("df_tracked");
      expect(engine.hasTable("df_tracked")).toBe(false);
      await expect(
        engine.query('SELECT * FROM "df_tracked"'),
      ).rejects.toThrow();
    });

    it("atomic ingest — a failed append leaves the prior table intact (no partial replace)", async () => {
      // Contract: if registerArrowTable throws mid-append (e.g. type mismatch),
      // the previously registered table must be unchanged and still queryable.
      // The staging-table swap ensures this; the old NDJSON path did NOT.
      engine = new NativeDuckDBEngine();

      // Register the initial table with known data.
      await engine.registerArrowTable("df_atomic", producerBuffer());

      // Confirm the initial data is there (3 rows).
      const before = await engine.query(
        'SELECT COUNT(*) AS cnt FROM "df_atomic"',
      );
      expect(Number(before.rows[0]?.cnt)).toBe(3);

      // Attempt a second registration with corrupted (non-Arrow) bytes.
      // This should throw during staging-table creation or append.
      await expect(
        engine.registerArrowTable(
          "df_atomic",
          new Uint8Array([0xff, 0xfe, 0x00, 0x01]), // not valid Arrow IPC
        ),
      ).rejects.toThrow();

      // The live table must still have the original 3 rows — not 0 or partial.
      const after = await engine.query(
        'SELECT COUNT(*) AS cnt FROM "df_atomic"',
      );
      expect(Number(after.rows[0]?.cnt)).toBe(3);
    });
  });
});
