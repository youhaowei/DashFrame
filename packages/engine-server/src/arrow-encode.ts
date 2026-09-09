/**
 * Server-side Arrow IPC encoding for native DuckDB results.
 *
 * The type map, the encoding choice per `ColumnType`, and the value
 * normalization all come from `@dashframe/engine`'s type-translation contract;
 * this module is the `apache-arrow` half of it. That is what makes the binary
 * format the data path serves match what the renderer's producer emits — both
 * encode from the same table rather than from two switches that have to be
 * kept in step by hand.
 *
 * Values arrive already JSON-normalized (`getColumnsObjectJson`): BigInt →
 * string, Date/timestamp → string, so the contract's normalizers coerce them
 * to the Arrow physical type here.
 */
import {
  ARROW_ENCODING_BY_COLUMN_TYPE,
  defineColumnTypeMap,
  duckdbJsonToEpochMillis,
  duckdbJsonToNumber,
  DUCKDB_TYPE_NAMES_BY_COLUMN_TYPE,
  type ArrowEncodingName,
  type ColumnType,
} from "@dashframe/engine";
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

/**
 * The shared contract names DuckDB types; `DuckDBTypeId` turns a name into the
 * id a result actually carries. Resolving here rather than copying numbers
 * into the shared module keeps one table and no constant that can drift.
 */
const COLUMN_TYPE_BY_DUCKDB_TYPE_ID = new Map<number, ColumnType>(
  Object.entries(DUCKDB_TYPE_NAMES_BY_COLUMN_TYPE).flatMap(
    ([columnType, names]) =>
      names.map((name) => [
        DuckDBTypeId[name as keyof typeof DuckDBTypeId],
        columnType as ColumnType,
      ]),
  ),
);

/** Map a DuckDB type id to DashFrame's normalized `ColumnType`. */
export function duckdbTypeIdToColumnType(
  typeId: number | undefined,
): ColumnType {
  return typeId === undefined
    ? "unknown"
    : (COLUMN_TYPE_BY_DUCKDB_TYPE_ID.get(typeId) ?? "unknown");
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

/** The `apache-arrow` constructor behind each name the contract encodes to. */
const ARROW_VECTOR_FACTORIES: Record<
  ArrowEncodingName,
  (values: unknown[]) => Vector<DataType>
> = {
  Bool: (values) => vectorFromArray(values, new Bool()),
  Float64: (values) => vectorFromArray(values, new Float64()),
  TimestampMillisecond: (values) =>
    vectorFromArray(values, new TimestampMillisecond()),
  Utf8: (values) => vectorFromArray(values, new Utf8()),
};

/** How a JSON-normalized DuckDB value is coerced for its Arrow encoding. */
const VALUE_NORMALIZERS = defineColumnTypeMap({
  boolean: (value: unknown) => (value == null ? null : Boolean(value)),
  number: duckdbJsonToNumber,
  date: duckdbJsonToEpochMillis,
  string: (value: unknown) => (value == null ? null : String(value)),
  unknown: (value: unknown) => (value == null ? null : String(value)),
});

function encodeColumn(
  colType: ColumnType,
  values: unknown[],
): Vector<DataType> {
  const normalize = VALUE_NORMALIZERS[colType];
  return ARROW_VECTOR_FACTORIES[ARROW_ENCODING_BY_COLUMN_TYPE[colType]](
    values.map((value) => normalize(value)),
  );
}
