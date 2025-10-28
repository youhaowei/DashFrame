export type ColumnType = "string" | "number" | "boolean" | "date" | "unknown";

export type DataFrameColumn = {
  name: string;
  type: ColumnType;
};

export type DataFrameRow = Record<string, unknown>;

export type DataFrame = {
  columns: DataFrameColumn[];
  rows: DataFrameRow[];
};
