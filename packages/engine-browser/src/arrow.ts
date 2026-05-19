import type { ColumnType } from "@dashframe/engine";
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

export function createArrowIPCBufferFromRows(
  rows: Record<string, unknown>[],
  columns: ArrowColumn[],
): Uint8Array {
  const arrowColumns: Record<string, Vector<DataType>> = {};

  for (const col of columns) {
    const values = rows.map((row) => row[col.name]);

    switch (col.type) {
      case "number":
        arrowColumns[col.name] = vectorFromArray(values, new Float64());
        break;
      case "boolean":
        arrowColumns[col.name] = vectorFromArray(values, new Bool());
        break;
      case "date":
        arrowColumns[col.name] = vectorFromArray(
          values,
          new TimestampMillisecond(),
        );
        break;
      default:
        arrowColumns[col.name] = vectorFromArray(values, new Utf8());
    }
  }

  return tableToIPC(new Table(arrowColumns));
}
