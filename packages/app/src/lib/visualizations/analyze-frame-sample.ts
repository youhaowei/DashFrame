import type { ColumnAnalysis, ColumnType, UUID } from "@dashframe/types";

type StructuralField = { id: UUID; name: string; type: string };

function distinct(values: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function base(
  field: StructuralField,
  values: readonly unknown[],
  rowCount: number,
) {
  const present = values.filter(
    (value) => value !== null && value !== undefined,
  );
  const unique = distinct(present);
  const sampleNullCount = values.length - present.length;
  const estimatedNullCount = values.length
    ? Math.round((sampleNullCount / values.length) * rowCount)
    : rowCount;
  return {
    columnName: field.id,
    cardinality: unique.length,
    uniqueness: present.length === 0 ? 0 : unique.length / present.length,
    nullCount: estimatedNullCount,
    sampleValues: unique.slice(0, 10),
    present,
  };
}

type SampleBase = ReturnType<typeof base>;

function withoutValues(common: SampleBase) {
  return {
    columnName: common.columnName,
    cardinality: common.cardinality,
    uniqueness: common.uniqueness,
    nullCount: common.nullCount,
    sampleValues: common.sampleValues,
  };
}

function numberAnalysis(common: SampleBase): ColumnAnalysis {
  const numbers = common.present.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  return {
    ...withoutValues(common),
    dataType: "number",
    semantic: "numerical",
    min: numbers.length ? Math.min(...numbers) : 0,
    max: numbers.length ? Math.max(...numbers) : 0,
    zeroCount: numbers.filter((value) => value === 0).length,
  };
}

function dateAnalysis(common: SampleBase): ColumnAnalysis {
  const dates = common.present
    .map((value) =>
      typeof value === "number" ? value : Date.parse(String(value)),
    )
    .filter(Number.isFinite);
  return {
    ...withoutValues(common),
    dataType: "date",
    semantic: "temporal",
    minDate: dates.length ? Math.min(...dates) : 0,
    maxDate: dates.length ? Math.max(...dates) : 0,
  };
}

function booleanAnalysis(common: SampleBase): ColumnAnalysis {
  return {
    ...withoutValues(common),
    dataType: "boolean",
    semantic: "boolean",
    trueCount: common.present.filter((value) => value === true).length,
    falseCount: common.present.filter((value) => value === false).length,
  };
}

function stringAnalysis(common: SampleBase): ColumnAnalysis {
  const strings = common.present.map(String);
  const lengths = strings.map((value) => value.length);
  const frequencies = new Map<string, number>();
  for (const value of strings) {
    frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
  }
  return {
    ...withoutValues(common),
    dataType: "string",
    semantic: common.cardinality <= 50 ? "categorical" : "text",
    minLength: lengths.length ? Math.min(...lengths) : 0,
    maxLength: lengths.length ? Math.max(...lengths) : 0,
    maxFrequencyRatio:
      strings.length === 0
        ? 0
        : Math.max(0, ...frequencies.values()) / strings.length,
  };
}

function analyzeField(
  field: StructuralField,
  values: readonly unknown[],
  rowCount: number,
): ColumnAnalysis {
  const common = base(field, values, rowCount);
  const type = field.type as ColumnType;
  if (type === "number") return numberAnalysis(common);
  if (type === "date") return dateAnalysis(common);
  if (type === "boolean") return booleanAnalysis(common);
  return stringAnalysis(common);
}

/** Build bounded, in-memory suggestion metadata from ordinary frame-query rows. */
export function analyzeFrameSample(
  schema: readonly StructuralField[],
  rows: readonly Record<string, unknown>[],
  rowCount: number,
): ColumnAnalysis[] {
  return schema.map((field) =>
    analyzeField(
      field,
      rows.map((row) => row[field.id]),
      rowCount,
    ),
  );
}
