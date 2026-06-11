/**
 * Server-side Arrow IPC encoding for native DuckDB results.
 *
 * Mirrors the renderer's `createArrowIPCBufferFromRows` (engine-browser) so the
 * binary format the data path serves matches exactly what DuckDB-WASM ingests.
 * DuckDB type IDs are normalized to DashFrame's `ColumnType`, then encoded with
 * `apache-arrow`'s `tableToIPC`. Values arrive already JSON-normalized
 * (`getColumnsObjectJson`): BigInt → string, Date/timestamp → string — so the
 * encoder coerces to the Arrow physical type here.
 */
import type { ColumnType } from "@dashframe/types";
import { DuckDBTypeId } from "@duckdb/node-api";
import {
  Bool,
  Float64,
  Table,
  tableToIPC,
  TimestampMillisecond,
  Utf8,
  vectorFromArray,
  type DataType,
  type Vector,
} from "apache-arrow";

export interface ResultColumn {
  name: string;
  /** DuckDB type id for the column (from `reader.columnTypes()[i].typeId`). */
  typeId: number | undefined;
  /** JSON-normalized column values (from `getColumnsObjectJson`). */
  values: unknown[];
}

/** Map a DuckDB type id to DashFrame's normalized `ColumnType`. */
export function duckdbTypeIdToColumnType(
  typeId: number | undefined,
): ColumnType {
  switch (typeId) {
    case DuckDBTypeId.BOOLEAN:
      return "boolean";
    case DuckDBTypeId.TINYINT:
    case DuckDBTypeId.SMALLINT:
    case DuckDBTypeId.INTEGER:
    case DuckDBTypeId.BIGINT:
    case DuckDBTypeId.UTINYINT:
    case DuckDBTypeId.USMALLINT:
    case DuckDBTypeId.UINTEGER:
    case DuckDBTypeId.UBIGINT:
    case DuckDBTypeId.HUGEINT:
    case DuckDBTypeId.UHUGEINT:
    case DuckDBTypeId.FLOAT:
    case DuckDBTypeId.DOUBLE:
    case DuckDBTypeId.DECIMAL:
      return "number";
    case DuckDBTypeId.DATE:
    case DuckDBTypeId.TIMESTAMP:
    case DuckDBTypeId.TIMESTAMP_S:
    case DuckDBTypeId.TIMESTAMP_MS:
    case DuckDBTypeId.TIMESTAMP_NS:
    case DuckDBTypeId.TIMESTAMP_TZ:
      return "date";
    case DuckDBTypeId.VARCHAR:
      return "string";
    default:
      return "unknown";
  }
}

/**
 * Encode JSON-normalized DuckDB result columns to an Arrow IPC stream buffer.
 */
export function duckdbColumnsToArrowIpc(columns: ResultColumn[]): Uint8Array {
  // Null prototype: a column legitimately aliased `__proto__` must land as a
  // plain own property, not a prototype assignment that silently drops it.
  const arrowColumns: Record<string, Vector<DataType>> = Object.create(null);
  const seenNames = new Set<string>();

  for (const col of columns) {
    // The Arrow table is assembled from a name-keyed record, so a duplicate
    // column name (legal SQL: `SELECT 1 AS v, 2 AS v`) would silently
    // overwrite the earlier column — corrupted results on the transport path.
    // Fail closed with a clear error instead; name-keyed consumers downstream
    // could not address the duplicates anyway. Names are tracked in a Set —
    // an `in` check would walk the prototype chain and false-positive on
    // inherited names (`SELECT 1 AS "toString"`).
    if (seenNames.has(col.name)) {
      throw new Error(
        `duckdbColumnsToArrowIpc: duplicate column name '${col.name}' in result — alias columns uniquely`,
      );
    }
    seenNames.add(col.name);
    const colType = duckdbTypeIdToColumnType(col.typeId);
    arrowColumns[col.name] = encodeColumn(colType, col.values);
  }

  return tableToIPC(new Table(arrowColumns));
}

function encodeColumn(
  colType: ColumnType,
  values: unknown[],
): Vector<DataType> {
  switch (colType) {
    case "number":
      return vectorFromArray(values.map(toNumber), new Float64());
    case "boolean":
      return vectorFromArray(
        values.map((v) => (v == null ? null : Boolean(v))),
        new Bool(),
      );
    case "date":
      return vectorFromArray(
        values.map(toEpochMillis),
        new TimestampMillisecond(),
      );
    default:
      return vectorFromArray(
        values.map((v) => (v == null ? null : String(v))),
        new Utf8(),
      );
  }
}

/** Matches a whole-integer string (the JSON form of BIGINT/UBIGINT/HUGEINT). */
const INTEGER_STRING = /^-?\d+$/;
/** Captures the integer part of a fractional string (the JSON form of DECIMAL). */
const DECIMAL_STRING = /^(-?\d+)\.\d+$/;

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  // BigInt and decimal arrive as strings from getColumnsObjectJson. The column
  // is encoded as Float64, which holds integers exactly only up to 2^53-1: a
  // BIGINT id or count — or a high-precision DECIMAL's integer part — beyond
  // that would round SILENTLY through Number(). Fail closed on unsafe integer
  // parts instead of corrupting results in transit.
  const s = String(value);
  const integerPart = INTEGER_STRING.test(s) ? s : s.match(DECIMAL_STRING)?.[1];
  if (integerPart != null) {
    const big = BigInt(integerPart);
    if (
      big > BigInt(Number.MAX_SAFE_INTEGER) ||
      big < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new Error(
        `arrow-encode: numeric value ${s} exceeds Float64's exact range (2^53-1) — would silently lose precision`,
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

function toEpochMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  // DuckDB serializes zone-less TIMESTAMP as "YYYY-MM-DD HH:MM:SS[.ffffff]".
  // Date.parse reads a zone-less date-time as host-LOCAL time, silently
  // shifting every value by the user's UTC offset in transit. Normalize to
  // ISO-8601 and pin UTC explicitly. A value that already carries a zone
  // designator (TIMESTAMP_TZ) keeps it — appending Z would double-shift it —
  // but an hour-only offset is widened to ±HH:00 so Date.parse accepts it.
  // Date-only strings (no time part) are already parsed as UTC per ISO-8601.
  let s = String(value).replace(" ", "T");
  if (s.includes("T")) {
    const zone = s.match(ZONE_DESIGNATOR)?.[1];
    if (zone == null) s += "Z";
    else if (HOUR_ONLY_OFFSET.test(zone)) s += ":00";
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}
