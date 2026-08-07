import {
  extractColumnAliasComponents,
  fieldIdToColumnAlias,
  metricIdToColumnAlias,
} from "@dashframe/engine";
import type { Field, Insight } from "@dashframe/types";

/**
 * Build a map of `${rightTableId}:${instanceIndex}` → leftKey from the field
 * instances emitted by buildInsightAvailableFields.
 *
 * Only fields returned by buildInsightAvailableFields advance an instance
 * counter. This keeps repeat-join display names aligned with the aliases the
 * SQL builder actually emitted when an invalid join is skipped.
 */
function buildJoinKeyByInstance(
  joins: NonNullable<Insight["joins"]>,
  resolvedFields: Field[],
): Map<string, string> {
  const resolvedSlots = new Set<string>();
  for (const field of resolvedFields) {
    const components = extractColumnAliasComponents(
      fieldIdToColumnAlias(field.id),
    );
    if (components) {
      resolvedSlots.add(`${field.tableId}:${components.instanceIndex}`);
    }
  }

  const result = new Map<string, string>();
  const instanceCount = new Map<string, number>();
  for (const join of joins) {
    const idx = instanceCount.get(join.rightTableId) ?? 0;
    const slot = `${join.rightTableId}:${idx}`;
    if (resolvedSlots.has(slot)) {
      result.set(slot, join.leftKey);
      instanceCount.set(join.rightTableId, idx + 1);
    }
  }
  return result;
}

/**
 * Build SQL-column-alias display names from fields resolved by
 * buildInsightAvailableFields. Repeat joins are disambiguated with their
 * left-key, while metric aliases use their metric names.
 */
export function buildInsightColumnDisplayNames(
  insight: Pick<Insight, "joins" | "metrics">,
  resolvedFields: Field[],
): Record<string, string> {
  const joinKeyByInstance = insight.joins?.length
    ? buildJoinKeyByInstance(insight.joins, resolvedFields)
    : new Map<string, string>();
  const repeatedFieldIds = new Set<string>();

  for (const field of resolvedFields) {
    const components = extractColumnAliasComponents(
      fieldIdToColumnAlias(field.id),
    );
    if (components && components.instanceIndex > 0) {
      repeatedFieldIds.add(components.uuid);
    }
  }

  const displayNames: Record<string, string> = {};
  for (const field of resolvedFields) {
    const alias = fieldIdToColumnAlias(field.id);
    const components = extractColumnAliasComponents(alias);
    const leftKey = components
      ? joinKeyByInstance.get(`${field.tableId}:${components.instanceIndex}`)
      : undefined;
    displayNames[alias] =
      components && repeatedFieldIds.has(components.uuid) && leftKey
        ? `${field.name} (${leftKey})`
        : field.name;
  }

  for (const metric of insight.metrics ?? []) {
    displayNames[metricIdToColumnAlias(metric.id)] = metric.name;
  }

  return displayNames;
}
