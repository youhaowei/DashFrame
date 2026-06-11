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
  const arrowColumns: Record<string, Vector<DataType>> = {};

  for (const col of columns) {
    // The Arrow table is assembled from a name-keyed record, so a duplicate
    // column name (legal SQL: `SELECT 1 AS v, 2 AS v`) would silently
    // overwrite the earlier column — corrupted results on the transport path.
    // Fail closed with a clear error instead; name-keyed consumers downstream
    // could not address the duplicates anyway.
    if (col.name in arrowColumns) {
      throw new Error(
        `duckdbColumnsToArrowIpc: duplicate column name '${col.name}' in result — alias columns uniquely`,
      );
    }
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

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  // BigInt and decimal arrive as strings from getColumnsObjectJson. The column
  // is encoded as Float64, which holds integers exactly only up to 2^53-1: a
  // BIGINT id or count beyond that would round SILENTLY through Number().
  // Fail closed on unsafe integers instead of corrupting results in transit.
  const s = String(value);
  if (INTEGER_STRING.test(s)) {
    const big = BigInt(s);
    if (
      big > BigInt(Number.MAX_SAFE_INTEGER) ||
      big < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new Error(
        `arrow-encode: integer value ${s} exceeds Float64's exact range (2^53-1) — would silently lose precision`,
      );
    }
    return Number(big);
  }
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function toEpochMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? null : ms;
}
