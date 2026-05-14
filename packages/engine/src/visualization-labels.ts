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
  return Boolean(label && /^(field|metric)_[0-9a-f_]+$/i.test(label));
}

export function getMetricDisplayLabel(
  metric: InsightMetric,
  fields: Field[] = [],
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
  const sourceLabel = sourceField?.name ?? metric.columnName;

  if (!sourceLabel || /^field_[0-9a-f_]+$/i.test(sourceLabel)) {
    return formatAggregationLabel(metric.aggregation);
  }

  if (/^metric_[0-9a-f_]+$/i.test(sourceLabel)) {
    return metric.name;
  }

  return `${formatAggregationLabel(metric.aggregation)} of ${sourceLabel}`;
}
