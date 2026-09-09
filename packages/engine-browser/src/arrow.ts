/**
 * Renderer-side Arrow IPC production.
 *
 * The encoding choice per `ColumnType` comes from `@dashframe/engine`'s
 * type-translation contract, the same table the server's
 * `duckdbColumnsToArrowIpc` encodes from — so the two producers agree by
 * construction rather than by comment.
 */
import {
  ARROW_ENCODING_BY_COLUMN_TYPE,
  type ArrowEncodingName,
  type ColumnType,
} from "@dashframe/engine";
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

export type ArrowColumn = {
  name: string;
  type: ColumnType;
};

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

export function createArrowIPCBufferFromRows(
  rows: Record<string, unknown>[],
  columns: ArrowColumn[],
): Uint8Array {
  const arrowColumns: Record<string, Vector<DataType>> = {};

  for (const col of columns) {
    const values = rows.map((row) => row[col.name]);

    arrowColumns[col.name] =
      ARROW_VECTOR_FACTORIES[ARROW_ENCODING_BY_COLUMN_TYPE[col.type]](values);
  }

  return tableToIPC(new Table(arrowColumns));
}
