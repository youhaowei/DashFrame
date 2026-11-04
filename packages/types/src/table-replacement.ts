import type { Field } from "./field";
import type { Metric } from "./metric";

/** Carry a stored field's sensitivity marker onto its replacement. */
function withStoredMarker(field: Field, storedField: Field): Field {
  return {
    ...field,
    sensitivity: storedField.sensitivity,
    sensitivityReason: storedField.sensitivityReason,
    sensitivitySource: storedField.sensitivitySource,
  };
}

/** The replacement's data changed, so a decision made on the old data is reset. */
function withUnclassifiedMarker(field: Field): Field {
  return {
    ...field,
    sensitivity: "unclassified",
    sensitivityReason: undefined,
    sensitivitySource: undefined,
  };
}

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
    const merged = { ...field, id: existingField.id };
    if (existingField.sensitivity === "sensitive")
      return withStoredMarker(merged, existingField);
    if (existingField.sensitivity === "cleared")
      return withUnclassifiedMarker(merged);
    return merged;
  });
}

/**
 * Decide replacement sensitivity against the stored fields at commit time.
 *
 * A replacement is merged from a snapshot of the table's fields, and no fence
 * covers a classification made after that snapshot. For each replacement
 * field whose id `mergeReplacementFields` preserved, the stored row wins: a
 * stored `sensitive` marker is carried over, and a `sensitive` marker the
 * snapshot supplied is replaced by the stored decision when the stored field
 * has since dropped it (a concurrent `cleared` still resets to `unclassified`,
 * as the merge does). Fields without a stored id, such as a connector
 * snapshot's freshly identified and reviewed fields, are returned unchanged.
 */
export function reconcileReplacementSensitivity(
  fields: Field[],
  storedFields: Field[] = [],
): Field[] {
  const storedFieldsById = new Map(
    storedFields.map((storedField) => [storedField.id, storedField]),
  );
  return fields.map((field) => {
    const storedField = storedFieldsById.get(field.id);
    if (!storedField) return field;
    if (storedField.sensitivity === "sensitive")
      return withStoredMarker(field, storedField);
    if (field.sensitivity !== "sensitive") return field;
    return storedField.sensitivity === "cleared"
      ? withUnclassifiedMarker(field)
      : withStoredMarker(field, storedField);
  });
}

/**
 * Drop metrics whose source column disappeared or is known to be incompatible.
 *
 * `sum` and `avg` need a numeric column. `min` and `max` are ordered
 * comparisons the query engine runs on every column type, so they survive
 * whenever the column does.
 */
export function retainReplacementMetrics(
  metrics: Metric[],
  fields: Field[],
): Metric[] {
  return metrics.filter((metric) => {
    if (metric.aggregation === "count" && !metric.columnName) return true;
    if (metric.columnName === undefined) return false;
    const matchingFields = fields.filter(
      (field) => field.columnName === metric.columnName,
    );
    if (matchingFields.length === 0) return false;
    if (metric.aggregation !== "sum" && metric.aggregation !== "avg") {
      return true;
    }
    return matchingFields.some(
      (field) => field.type === "number" || field.type === "unknown",
    );
  });
}
