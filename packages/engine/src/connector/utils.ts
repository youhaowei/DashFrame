import type {
  ColumnType,
  Field,
  SourceSchema,
  TableColumn,
  UUID,
} from "@dashframe/types";

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

export function inferStringColumnType(value: string | undefined): ColumnType {
  if (!value?.length) return "unknown";
  if (!Number.isNaN(Number(value))) return "number";
  if (value === "true" || value === "false") return "boolean";
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

  switch (type) {
    case "number": {
      const numeric = Number(raw);
      return Number.isNaN(numeric) ? null : numeric;
    }
    case "boolean":
      return raw === "true";
    case "date": {
      const date = new Date(raw);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    default:
      return raw;
  }
}

export function parsePrimitiveBoolean(
  raw: boolean | number | string | null,
): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const normalized = raw.toLowerCase().trim();
    return normalized === "true" || normalized === "1";
  }
  return typeof raw === "number" && raw === 1;
}

export function parsePrimitiveValueByType(
  raw: boolean | number | string | null,
  type: ColumnType,
): unknown {
  if (raw === null) {
    return null;
  }

  switch (type) {
    case "number": {
      if (typeof raw === "number") {
        return raw;
      }
      const numeric = Number(raw);
      return Number.isNaN(numeric) ? null : numeric;
    }
    case "boolean":
      return parsePrimitiveBoolean(raw);
    case "date": {
      if (typeof raw === "string") {
        const date = new Date(raw);
        return Number.isNaN(date.getTime()) ? null : date;
      }
      return null;
    }
    default:
      return String(raw);
  }
}

export function detectPrimaryKeyColumn(columns: { name: string }[]): string | undefined {
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
