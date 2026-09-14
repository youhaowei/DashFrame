/**
 * The type-translation contract: how a DashFrame `ColumnType`, an Arrow
 * physical type and a DuckDB type name refer to the same thing, and how a
 * value crosses between them.
 *
 * Three packages sit on this seam and each speaks a different library:
 *
 * - `@dashframe/engine-server` ingests `apache-arrow` IPC into DuckDB and
 *   encodes DuckDB results back to `apache-arrow` IPC.
 * - `@dashframe/engine-browser` produces the same IPC shape with
 *   `apache-arrow` in the renderer.
 * - `@dashframe/visualization` decodes that IPC with `@uwdata/flechette` for
 *   charts.
 *
 * This package depends on none of them — it is the one place the three can
 * share a contract without any of them acquiring the others' dependencies.
 * That is why the tables below hold **names**, not enum values: each consumer
 * resolves a name through its own library's enum at its own boundary
 * (`DuckDBTypeId[name]`, `Type[name]`, a constructor lookup), so there is one
 * table and no hand-copied numeric constant that can drift silently.
 */
import { defineColumnTypeMap } from "../column-type-map";
import type { ColumnType } from "@dashframe/types";

/**
 * The Arrow physical type each `ColumnType` is encoded as on the wire.
 *
 * Both producers — the renderer's `createArrowIPCBufferFromRows` and the
 * server's `duckdbColumnsToArrowIpc` — encode from this table, which is what
 * makes "the binary the data path serves matches what the renderer decodes" a
 * checkable statement rather than a comment. Names are `apache-arrow` type
 * constructor names; each producer maps a name to the constructor itself.
 *
 * `date` is a timestamp, not a date: DuckDB DATE and TIMESTAMP both normalize
 * to `date`, and one physical type has to carry both.
 */
export const ARROW_ENCODING_BY_COLUMN_TYPE = defineColumnTypeMap({
  boolean: "Bool",
  number: "Float64",
  date: "TimestampMillisecond",
  string: "Utf8",
  unknown: "Utf8",
});

/** An `apache-arrow` type constructor name this contract encodes to. */
export type ArrowEncodingName =
  (typeof ARROW_ENCODING_BY_COLUMN_TYPE)[ColumnType];

/**
 * DuckDB result type names that normalize to each `ColumnType`.
 *
 * Names are `DuckDBTypeId` member names; the server resolves them to type ids
 * with `DuckDBTypeId[name]`. Anything absent here is `unknown` and travels as
 * a string.
 */
export const DUCKDB_TYPE_NAMES_BY_COLUMN_TYPE = defineColumnTypeMap({
  boolean: ["BOOLEAN"],
  number: [
    "TINYINT",
    "SMALLINT",
    "INTEGER",
    "BIGINT",
    "UTINYINT",
    "USMALLINT",
    "UINTEGER",
    "UBIGINT",
    "HUGEINT",
    "UHUGEINT",
    "FLOAT",
    "DOUBLE",
    "DECIMAL",
  ],
  date: [
    "DATE",
    "TIMESTAMP",
    "TIMESTAMP_S",
    "TIMESTAMP_MS",
    "TIMESTAMP_NS",
    "TIMESTAMP_TZ",
  ],
  string: ["VARCHAR"],
  unknown: [],
});

/** A DuckDB type name this contract knows — the vocabulary of the table above. */
export type DuckDBTypeName =
  (typeof DUCKDB_TYPE_NAMES_BY_COLUMN_TYPE)[ColumnType][number];

/**
 * DuckDB column type for each Arrow logical type, used for ingest DDL.
 *
 * Keys are `apache-arrow` `Type` enum member names; values are constrained to
 * `DuckDBTypeName`, so ingest and egress share one vocabulary and a typo'd DDL
 * type is a compile error here rather than a `CREATE TABLE` that fails at
 * runtime. (`engine-server` separately proves every such name is a real
 * `DuckDBTypeId` member, so the two checks together admit only types DuckDB
 * actually has.)
 *
 * The renderer's producer emits only Float64, Bool, TimestampMillisecond and
 * Utf8, which map losslessly; Int and Date are covered so a different producer
 * round-trips rather than degrading. Anything absent falls back to
 * `DEFAULT_DUCKDB_INGEST_TYPE`.
 */
export const DUCKDB_INGEST_TYPE_BY_ARROW_TYPE = {
  Bool: "BOOLEAN",
  Int: "BIGINT",
  Float: "DOUBLE",
  Timestamp: "TIMESTAMP",
  Date: "DATE",
  Utf8: "VARCHAR",
  LargeUtf8: "VARCHAR",
} as const satisfies Record<string, DuckDBTypeName>;

/** An `apache-arrow` `Type` member name this contract can ingest natively. */
export type IngestibleArrowTypeName =
  keyof typeof DUCKDB_INGEST_TYPE_BY_ARROW_TYPE;

/** Where an Arrow type with no native mapping lands: stringified VARCHAR. */
export const DEFAULT_DUCKDB_INGEST_TYPE: DuckDBTypeName = "VARCHAR";

/**
 * Decode options the chart side must pass to flechette's `tableFromIPC`.
 *
 * The two Arrow libraries disagree on what a temporal value is when you read
 * it: `apache-arrow`'s `.get()` normalizes temporal types to epoch
 * milliseconds, while flechette's default hands back the raw stored value —
 * the disagreement tracked in https://github.com/youhaowei/DashFrame/issues/95.
 * On DashFrame's egress every temporal column leaves as
 * `TimestampMillisecond` (see `ARROW_ENCODING_BY_COLUMN_TYPE`), so what this
 * option buys today is the *shape*: `useDate: true` materializes temporal
 * columns as JS `Date`s rather than numbers, which is what Mosaic and vgplot
 * expect. It is also what would keep a producer that emitted Date32 directly
 * from reading back as a 1970-era instant.
 */
export const FLECHETTE_DECODE_OPTIONS = { useDate: true } as const;

/** Module-private: the only conversion that needs it is the one below. */
const MS_PER_DAY = 86_400_000;

/**
 * Convert an `apache-arrow` Date `.get()` result to the day count DuckDB DATE
 * stores.
 *
 * In apache-arrow v21 the Date visitor normalizes both Date32 (DAY) and Date64
 * (MILLISECOND) to epoch millis on read, so one millis → days conversion is
 * correct for both units. Pinned by the Date32 round-trip test.
 */
export function arrowDateToDuckDBDays(value: unknown): number {
  return Math.floor(Number(value) / MS_PER_DAY);
}

/** Matches a whole-integer string (the JSON form of BIGINT/UBIGINT/HUGEINT). */
const INTEGER_STRING = /^-?\d+$/;
/** Captures the integer part of a fractional string (the JSON form of DECIMAL). */
const DECIMAL_STRING = /^(-?\d+)\.\d+$/;

/**
 * Normalize one JSON-serialized DuckDB value to a Float64-safe number.
 *
 * DuckDB's `getColumnsObjectJson` renders BigInt and DECIMAL as strings. The
 * column is encoded as Float64, which holds integers exactly only up to
 * 2^53-1: a BIGINT id or count — or a high-precision DECIMAL's integer part —
 * beyond that would round SILENTLY through `Number()`. Fail closed on unsafe
 * integer parts instead of corrupting results in transit.
 *
 * Policy: the guard covers the INTEGER part only — magnitude (IDs, money).
 * Fractional digits beyond Float64's precision round to nearest; that is the
 * accepted semantics of the f64 physical type this contract encodes to, and
 * failing closed on every >15-significant-digit fraction would break
 * legitimate DECIMAL(38,20) columns over sub-precision noise. Exact decimal
 * semantics would require a DECIMAL128 Arrow column type on both ends — out of
 * scope here.
 */
export function duckdbJsonToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  const s = String(value);
  const integerPart = INTEGER_STRING.test(s) ? s : s.match(DECIMAL_STRING)?.[1];
  if (integerPart != null) {
    const big = BigInt(integerPart);
    if (
      big > BigInt(Number.MAX_SAFE_INTEGER) ||
      big < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new Error(
        `type-translation: numeric value ${s} exceeds Float64's exact range (2^53-1) — would silently lose precision`,
      );
    }
    if (integerPart === s) return Number(big);
  }
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

/**
 * Trailing zone designator on a date-time string: `Z` or a numeric offset
 * (`-07`, `-0800`, `+05:30`). DuckDB renders TIMESTAMP_TZ with an hour-only
 * offset (`2024-01-01 00:00:00-07`), which `Date.parse` rejects.
 */
const ZONE_DESIGNATOR = /([zZ]|[+-]\d{2}(?::?\d{2})?)$/;
const HOUR_ONLY_OFFSET = /^[+-]\d{2}$/;

/**
 * Normalize one JSON-serialized DuckDB temporal value to epoch milliseconds.
 *
 * DuckDB serializes zone-less TIMESTAMP as `YYYY-MM-DD HH:MM:SS[.ffffff]`.
 * `Date.parse` reads a zone-less date-time as host-LOCAL time, silently
 * shifting every value by the machine's UTC offset in transit. Normalize to
 * ISO-8601 and pin UTC explicitly. A value that already carries a zone
 * designator (TIMESTAMP_TZ) keeps it — appending `Z` would double-shift it —
 * but an hour-only offset is widened to ±HH:00 so `Date.parse` accepts it.
 * Date-only strings (no time part) are already parsed as UTC per ISO-8601.
 */
export function duckdbJsonToEpochMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  let s = String(value).replace(" ", "T");
  if (s.includes("T")) {
    const zone = s.match(ZONE_DESIGNATOR)?.[1];
    if (zone == null) s += "Z";
    else if (HOUR_ONLY_OFFSET.test(zone)) s += ":00";
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}
