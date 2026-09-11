/**
 * The cross-library round trip: apache-arrow in → DuckDB → apache-arrow out →
 * flechette decode.
 *
 * This is the only place in the tree where both Arrow libraries read the same
 * bytes, which is the whole subject of the type-translation contract. The
 * per-leg tests elsewhere cannot see it: `native-engine.test.ts` stops at what
 * DuckDB stored, and the chart side never ingests.
 *
 * What it pins, precisely:
 *
 * - the ingest conversions — an apache-arrow Date32/Date64/Timestamp `.get()`
 *   result reaching DuckDB as the right day or instant, and Int64 as BIGINT;
 * - the DuckDB type each Arrow type is declared as;
 * - the egress encoding and the decode *shape* flechette produces under
 *   `FLECHETTE_DECODE_OPTIONS`.
 *
 * What it does NOT pin, so nobody reads more into it: flechette never sees a
 * Date32 on this path. Egress maps every DuckDB DATE and TIMESTAMP to
 * `TimestampMillisecond` (`ARROW_ENCODING_BY_COLUMN_TYPE`), so the #95
 * apache-arrow-vs-flechette Date32 read disagreement is unreachable here. A
 * future egress that exported DuckDB's own Arrow would reach it, and would
 * need its own pinning.
 */
import { FLECHETTE_DECODE_OPTIONS } from "@dashframe/engine";
import { tableFromIPC as flechetteTableFromIPC } from "@uwdata/flechette";
import {
  Bool,
  DateDay,
  DateMillisecond,
  Float64,
  Int64,
  LargeUtf8,
  Table,
  tableToIPC,
  TimestampMillisecond,
  Utf8,
  vectorFromArray,
} from "apache-arrow";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { NativeDuckDBEngine } from "./native-engine";

let engine: NativeDuckDBEngine | undefined;

afterEach(async () => {
  await engine?.dispose();
  engine = undefined;
});

/** Ingest one Arrow table, read it back, and decode the result with flechette. */
async function roundTrip(
  table: Table,
  select = "*",
): Promise<Record<string, unknown>[]> {
  engine = new NativeDuckDBEngine();
  await engine.registerArrowTable("df_roundtrip", tableToIPC(table));
  const ipc = await engine.queryArrow(
    `SELECT ${select} FROM "df_roundtrip" ORDER BY rowid`,
  );
  return flechetteTableFromIPC(
    ipc,
    FLECHETTE_DECODE_OPTIONS,
  ).toArray() as Record<string, unknown>[];
}

/** Read one decoded cell as a Date, failing the test if it is not one. */
function decodedDate(
  rows: Record<string, unknown>[],
  index: number,
  key: string,
): Date {
  const value = rows[index]?.[key];
  if (!(value instanceof Date)) {
    throw new Error(`row ${index} column ${key} decoded as ${String(value)}`);
  }
  return value;
}

const DAY_2021_01_02 = Date.UTC(2021, 0, 2);
const DAY_1999_12_31 = Date.UTC(1999, 11, 31);
const DAY_2024_06_13 = Date.UTC(2024, 5, 13);
const INSTANT = Date.UTC(2024, 2, 5, 6, 7, 8, 90);

describe("Arrow type translation — apache-arrow → DuckDB → flechette", () => {
  it("round-trips every Arrow type the contract names", async () => {
    const rows = await roundTrip(
      new Table({
        f64: vectorFromArray([1.5, null, -0.25], new Float64()),
        bool: vectorFromArray([true, null, false], new Bool()),
        ts: vectorFromArray([INSTANT, null, 0], new TimestampMillisecond()),
        text: vectorFromArray(["a", null, "ünïcøde ' \" "], new Utf8()),
        bigtext: vectorFromArray(["x", null, "y"], new LargeUtf8()),
        i64: vectorFromArray([9007199254740991n, null, -42n], new Int64()),
        d32: vectorFromArray(
          [DAY_2021_01_02, null, DAY_1999_12_31],
          new DateDay(),
        ),
        d64: vectorFromArray(
          [DAY_2024_06_13, null, DAY_1999_12_31],
          new DateMillisecond(),
        ),
      }),
    );

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.f64)).toEqual([1.5, null, -0.25]);
    expect(rows.map((r) => r.bool)).toEqual([true, null, false]);
    // BIGINT egresses as Float64 — the contract's `number` encoding — so the
    // decoded value is a JS number, exact up to 2^53-1.
    expect(rows.map((r) => r.i64)).toEqual([9007199254740991, null, -42]);
    expect(rows.map((r) => r.text)).toEqual(["a", null, "ünïcøde ' \" "]);
    expect(rows.map((r) => r.bigtext)).toEqual(["x", null, "y"]);

    // Temporal columns decode as JS Dates because of the contract's decode
    // options; without them flechette would hand back raw stored values.
    for (const key of ["ts", "d32", "d64"]) {
      expect(rows[0]?.[key]).toBeInstanceOf(Date);
      expect(rows[1]?.[key]).toBeNull();
    }
    expect(decodedDate(rows, 0, "ts").getTime()).toBe(INSTANT);
    expect(decodedDate(rows, 2, "ts").getTime()).toBe(0);
    // The ingest conversion: an apache-arrow Date32 must reach DuckDB as the
    // same calendar day, not as a 1970-era instant that a day-count read as
    // millis would produce.
    expect(decodedDate(rows, 0, "d32").toISOString()).toBe(
      "2021-01-02T00:00:00.000Z",
    );
    expect(decodedDate(rows, 2, "d32").toISOString()).toBe(
      "1999-12-31T00:00:00.000Z",
    );
    expect(decodedDate(rows, 0, "d64").toISOString()).toBe(
      "2024-06-13T00:00:00.000Z",
    );
    expect(decodedDate(rows, 2, "d64").toISOString()).toBe(
      "1999-12-31T00:00:00.000Z",
    );
  });

  it("keeps the DuckDB column types the contract's ingest table declares", async () => {
    const rows = await roundTrip(
      new Table({
        f64: vectorFromArray([1], new Float64()),
        bool: vectorFromArray([true], new Bool()),
        ts: vectorFromArray([INSTANT], new TimestampMillisecond()),
        text: vectorFromArray(["a"], new Utf8()),
        bigtext: vectorFromArray(["x"], new LargeUtf8()),
        i64: vectorFromArray([1n], new Int64()),
        d32: vectorFromArray([DAY_2021_01_02], new DateDay()),
        d64: vectorFromArray([DAY_2024_06_13], new DateMillisecond()),
      }),
      `typeof(f64) AS t_f64, typeof(bool) AS t_bool, typeof(ts) AS t_ts,
       typeof(text) AS t_text, typeof(bigtext) AS t_bigtext,
       typeof(i64) AS t_i64, typeof(d32) AS t_d32,
       typeof(d64) AS t_d64`,
    );

    expect(rows[0]).toMatchObject({
      t_f64: "DOUBLE",
      t_bool: "BOOLEAN",
      t_ts: "TIMESTAMP",
      t_text: "VARCHAR",
      t_bigtext: "VARCHAR",
      t_i64: "BIGINT",
      t_d32: "DATE",
      t_d64: "DATE",
    });
  });
});
