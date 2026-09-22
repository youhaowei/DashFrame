import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import type { Field, InsightSort } from "@dashframe/types";

import type { EffectiveInsightDefinition } from "./materializer";

function metricSortAlias(
  reference: string,
  insight: EffectiveInsightDefinition,
): string | undefined {
  const metric = insight.metrics.find(
    (candidate) =>
      candidate.id === reference ||
      metricIdToColumnAlias(candidate.id) === reference,
  );
  return metric ? metricIdToColumnAlias(metric.id) : undefined;
}

function matchingFields(reference: string, fields: readonly Field[]): Field[] {
  return fields.filter(
    (field) =>
      (field.columnName ?? field.name) === reference ||
      field.id === reference ||
      fieldIdToColumnAlias(field.id) === reference,
  );
}

function pivotTupleMatches(
  sort: InsightSort,
  insight: EffectiveInsightDefinition,
): boolean {
  if (sort.pivotValues === undefined) return true;
  const pivotFields = insight.reporting?.pivotFields ?? [];
  const tupleFields = sort.pivotValues.map((value) => value.fieldId);
  return (
    tupleFields.length > 0 &&
    tupleFields.length === pivotFields.length &&
    new Set(tupleFields).size === tupleFields.length &&
    tupleFields.every((id) => pivotFields.includes(id)) &&
    pivotFields.every((id) => insight.selectedFields.includes(id))
  );
}

function reconcileSort(
  sort: InsightSort,
  insight: EffectiveInsightDefinition,
  fields: readonly Field[],
): InsightSort | undefined {
  const metricAlias = metricSortAlias(sort.field, insight);
  if (metricAlias) {
    return pivotTupleMatches(sort, insight)
      ? { ...sort, field: metricAlias }
      : undefined;
  }
  const matches = matchingFields(sort.field, fields);
  if (matches.length > 1) throw new Error("RUNTIME_SORT_REFERENCE_AMBIGUOUS");
  const field = matches[0];
  if (!field) throw new Error("RUNTIME_SORT_REFERENCE_INVALID");
  return insight.selectedFields.includes(field.id)
    ? { ...sort, field: fieldIdToColumnAlias(field.id) }
    : undefined;
}

/** Reconcile saved sorts after runtime dimensions change, before SQL compilation. */
export function runtimeSortsForCompile(
  insight: EffectiveInsightDefinition,
  fields: readonly Field[],
): InsightSort[] | undefined {
  if (!insight.runtimeDimensionsChanged && !insight.runtimeSortOverride) {
    return insight.sorts;
  }
  const savedSorts = insight.sorts;
  if (!savedSorts?.length) return savedSorts;
  const effective: InsightSort[] = [];
  for (const sort of savedSorts) {
    const metricAlias = metricSortAlias(sort.field, insight);
    if (
      insight.runtimeSortOverride &&
      metricAlias &&
      insight.reporting?.pivotFields?.length &&
      sort.pivotValues === undefined
    ) {
      throw new Error("RUNTIME_PIVOT_SORT_REQUIRES_TUPLE");
    }
    const reconciled = reconcileSort(sort, insight, fields);
    if (reconciled) effective.push(reconciled);
    else if (
      insight.runtimeSortOverride &&
      metricAlias &&
      insight.reporting?.pivotFields?.length
    ) {
      throw new Error("RUNTIME_PIVOT_SORT_REQUIRES_TUPLE");
    }
  }
  if (insight.limit !== undefined && effective.length === 0) {
    throw new Error("RUNTIME_LIMIT_REQUIRES_SORT");
  }
  return effective;
}
