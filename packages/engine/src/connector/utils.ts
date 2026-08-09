import type {
  ColumnType,
  Field,
  SourceSchema,
  TableColumn,
  UUID,
} from "@dashframe/types";
import { defineColumnTypeMap } from "../column-type-map";

export type ConnectorColumn = {
  name: string;
  type: ColumnType;
};

export type SystemFieldInput = {
  name: string;
  type: ColumnType;
  columnName?: string;
  isIdentifier?: boolean;
  isReference?: boolean;
};

type PrimitiveValue = boolean | number | string;

export function inferStringColumnType(value: string | undefined): ColumnType {
  if (!value?.length) return "unknown";
  if (!Number.isNaN(Number(value))) return "number";
  const normalized = value.toLowerCase().trim();
  if (
    normalized === "true" ||
    normalized === "false" ||
    normalized === "yes" ||
    normalized === "no" ||
    normalized === "y" ||
    normalized === "n"
  ) {
    return "boolean";
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return "date";
  return "string";
}

export function parseStringValueByType(
  raw: string | undefined,
  type: ColumnType,
): unknown {
  if (raw === undefined || raw === "") {
    return null;
  }

  return STRING_VALUE_PARSERS[type](raw);
}

const STRING_VALUE_PARSERS = defineColumnTypeMap({
  number: (raw: string): unknown => {
    const numeric = Number(raw);
    return Number.isNaN(numeric) ? null : numeric;
  },
  boolean: (raw: string): unknown => {
    const normalized = raw.toLowerCase().trim();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
    if (normalized === "yes" || normalized === "y") return true;
    if (normalized === "no" || normalized === "n") return false;
    return null;
  },
  date: (raw: string): unknown => {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  },
  string: (raw: string): unknown => raw,
  unknown: (raw: string): unknown => raw,
});

export function parsePrimitiveBoolean(
  raw: boolean | number | string | null,
): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const normalized = raw.toLowerCase().trim();
    return (
      normalized === "true" ||
      normalized === "1" ||
      normalized === "yes" ||
      normalized === "y"
    );
  }
  return typeof raw === "number" && raw === 1;
}

function parsePrimitiveDate(raw: PrimitiveValue): Date | null {
  if (typeof raw === "number") {
    const timestamp = Math.abs(raw) < 1_000_000_000_000 ? raw * 1000 : raw;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof raw === "string") {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function parsePrimitiveValueByType(
  raw: boolean | number | string | null,
  type: ColumnType,
): unknown {
  if (raw === null) {
    return null;
  }

  return PRIMITIVE_VALUE_PARSERS[type](raw);
}

const PRIMITIVE_VALUE_PARSERS = defineColumnTypeMap({
  number: (raw: PrimitiveValue): unknown => {
    if (typeof raw === "number") {
      return raw;
    }
    const numeric = Number(raw);
    return Number.isNaN(numeric) ? null : numeric;
  },
  boolean: (raw: PrimitiveValue): unknown => parsePrimitiveBoolean(raw),
  date: (raw: PrimitiveValue): unknown => parsePrimitiveDate(raw),
  string: (raw: PrimitiveValue): unknown => String(raw),
  unknown: (raw: PrimitiveValue): unknown => String(raw),
});

export function detectPrimaryKeyColumn(
  columns: { name: string }[],
): string | undefined {
  return columns.find((col) => /^_?id$/i.test(col.name))?.name;
}

export function createSourceSchema(
  columns: TableColumn[],
  lastSyncedAt: number = Date.now(),
): SourceSchema {
  return {
    columns,
    version: 1,
    lastSyncedAt,
  };
}

export function createFieldsFromColumns(
  columns: ConnectorColumn[],
  tableId: UUID,
  systemFields: SystemFieldInput[] = [],
): Field[] {
  return [
    ...systemFields.map((field) => ({
      id: crypto.randomUUID(),
      name: field.name,
      tableId,
      columnName: field.columnName,
      type: field.type,
      isIdentifier: field.isIdentifier,
      isReference: field.isReference,
    })),
    ...columns.map((col) => ({
      id: crypto.randomUUID(),
      name: col.name,
      tableId,
      columnName: col.name,
      type: col.type,
    })),
  ];
}
