import {
  buildInsightAvailableFields,
  extractColumnAliasComponents,
  fieldIdToColumnAlias,
  metricIdToColumnAlias,
} from "@dashframe/engine";
import type { DataTable, Field, Insight, UUID } from "@dashframe/types";

type InsightTableContext = {
  baseTable: DataTable;
  joinedTables: Map<UUID, DataTable>;
};

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
  tables: InsightTableContext | undefined,
): Map<string, string> {
  if (!tables) return new Map<string, string>();

  const resolvedAliases = new Set(
    resolvedFields.map((field) => fieldIdToColumnAlias(field.id)),
  );
  let previousFieldIds = new Set(
    (tables.baseTable.fields ?? [])
      .filter((field) => !field.name.startsWith("_"))
      .map((field) => field.id),
  );

  const result = new Map<string, string>();
  for (const [index, join] of joins.entries()) {
    const fields = buildInsightAvailableFields(
      tables.baseTable,
      tables.joinedTables,
      { joins: joins.slice(0, index + 1) },
    );
    if (!fields) continue;

    for (const field of fields) {
      if (previousFieldIds.has(field.id) || field.tableId !== join.rightTableId)
        continue;
      const alias = fieldIdToColumnAlias(field.id);
      const components = extractColumnAliasComponents(alias);
      if (components && resolvedAliases.has(alias)) {
        result.set(
          `${field.tableId}:${components.instanceIndex}`,
          join.leftKey,
        );
      }
    }
    previousFieldIds = new Set(fields.map((field) => field.id));
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
  tables?: InsightTableContext,
): Record<string, string> {
  const joinKeyByInstance = insight.joins?.length
    ? buildJoinKeyByInstance(insight.joins, resolvedFields, tables)
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
