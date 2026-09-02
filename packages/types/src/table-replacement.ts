import type { Field } from "./field";
import type { Metric } from "./metric";

/** Keep identities only when a source column has one match on both sides. */
export function mergeReplacementFields(
  fields: Field[],
  existingFields: Field[] = [],
): Field[] {
  const existingFieldsByColumnName = new Map<string, Field[]>();
  const newFieldCountsByColumnName = new Map<string, number>();

  for (const existingField of existingFields) {
    if (existingField.columnName === undefined) continue;
    const matchingFields = existingFieldsByColumnName.get(
      existingField.columnName,
    );
    existingFieldsByColumnName.set(existingField.columnName, [
      ...(matchingFields ?? []),
      existingField,
    ]);
  }

  for (const field of fields) {
    if (field.columnName === undefined) continue;
    newFieldCountsByColumnName.set(
      field.columnName,
      (newFieldCountsByColumnName.get(field.columnName) ?? 0) + 1,
    );
  }

  return fields.map((field) => {
    if (
      field.columnName === undefined ||
      newFieldCountsByColumnName.get(field.columnName) !== 1
    ) {
      return field;
    }

    const matchingExistingFields = existingFieldsByColumnName.get(
      field.columnName,
    );
    const existingField = matchingExistingFields?.[0];
    if (!existingField || matchingExistingFields.length !== 1) return field;
    if (existingField.sensitivity === "sensitive") {
      return {
        ...field,
        id: existingField.id,
        sensitivity: existingField.sensitivity,
        sensitivityReason: existingField.sensitivityReason,
        sensitivitySource: existingField.sensitivitySource,
      };
    }

    return {
      ...field,
      id: existingField.id,
      ...(existingField.sensitivity === "cleared"
        ? {
            sensitivity: "unclassified" as const,
            sensitivityReason: undefined,
            sensitivitySource: undefined,
          }
        : {}),
    };
  });
}

/** Drop only metrics whose source column disappeared from the new schema. */
export function retainReplacementMetrics(
  metrics: Metric[],
  fields: Field[],
): Metric[] {
  const columnNames = new Set(
    fields.flatMap((field) =>
      field.columnName === undefined ? [] : [field.columnName],
    ),
  );

  return metrics.filter(
    (metric) =>
      (metric.aggregation === "count" && !metric.columnName) ||
      (metric.columnName !== undefined && columnNames.has(metric.columnName)),
  );
}
