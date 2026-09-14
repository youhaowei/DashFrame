import type { Field, InsightMetric } from "@dashframe/types";

import { fieldIdToColumnAlias } from "./sql";

export function formatAggregationLabel(
  aggregation: InsightMetric["aggregation"],
) {
  switch (aggregation) {
    case "avg":
      return "Average";
    case "count":
      return "Count";
    case "count_distinct":
      return "Distinct count";
    case "max":
      return "Maximum";
    case "min":
      return "Minimum";
    case "sum":
      return "Sum";
  }
}

export function isGeneratedColumnLabel(label: string | undefined) {
  return Boolean(
    label && /^(?:field|metric)_[0-9a-f_]+(?:_j\d+)?$/i.test(label),
  );
}

export function getMetricDisplayLabel(
  metric: InsightMetric,
  fields: Field[] = [],
  columnDisplayNames: Readonly<Record<string, string>> = {},
) {
  if (metric.aggregation === "count" && !metric.columnName) {
    return metric.name || "Count of rows";
  }

  const sourceField = fields.find(
    (field) =>
      field.columnName === metric.columnName ||
      field.name === metric.columnName ||
      fieldIdToColumnAlias(field.id) === metric.columnName,
  );
  const mappedSourceLabel = metric.columnName
    ? columnDisplayNames[metric.columnName]
    : undefined;
  const sourceLabel =
    mappedSourceLabel ?? sourceField?.name ?? metric.columnName;

  if (
    !sourceLabel ||
    (isGeneratedColumnLabel(sourceLabel) && /^field_/i.test(sourceLabel))
  ) {
    return formatAggregationLabel(metric.aggregation);
  }

  if (isGeneratedColumnLabel(sourceLabel) && /^metric_/i.test(sourceLabel)) {
    return metric.name;
  }

  return `${formatAggregationLabel(metric.aggregation)} of ${sourceLabel}`;
}
