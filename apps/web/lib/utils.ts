import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type {
  ColumnType,
  DataFrameColumn,
  Field,
  UUID,
} from "@dashframe/dataframe";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generate a new UUID v4 using the Web Crypto API.
 */
export function generateUUID(): UUID {
  return crypto.randomUUID() as UUID;
}

export function convertColumnsToFields(
  columns: DataFrameColumn[],
  tableId: UUID,
): Field[] {
  return columns.map((column) => {
    const normalizedType: ColumnType =
      column.type === "number" ||
      column.type === "date" ||
      column.type === "boolean"
        ? column.type
        : "string";

    return {
      id: crypto.randomUUID(),
      name: column.name,
      tableId,
      columnName: column.name,
      type: normalizedType,
    };
  });
}
