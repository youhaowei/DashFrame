import { defineColumnTypeMap, type ColumnType } from "@dashframe/engine";
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

const ARROW_VECTOR_FACTORIES = defineColumnTypeMap({
  number: (values: unknown[]) => vectorFromArray(values, new Float64()),
  boolean: (values: unknown[]) => vectorFromArray(values, new Bool()),
  date: (values: unknown[]) =>
    vectorFromArray(values, new TimestampMillisecond()),
  string: (values: unknown[]) => vectorFromArray(values, new Utf8()),
  unknown: (values: unknown[]) => vectorFromArray(values, new Utf8()),
});

export function createArrowIPCBufferFromRows(
  rows: Record<string, unknown>[],
  columns: ArrowColumn[],
): Uint8Array {
  const arrowColumns: Record<string, Vector<DataType>> = {};

  for (const col of columns) {
    const values = rows.map((row) => row[col.name]);

    arrowColumns[col.name] = ARROW_VECTOR_FACTORIES[col.type](values);
  }

  return tableToIPC(new Table(arrowColumns));
}
