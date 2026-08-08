import {
  extractColumnAliasComponents,
  fieldIdToColumnAlias,
  metricIdToColumnAlias,
} from "@dashframe/engine";
import type { DataTable, Field, Insight, UUID } from "@dashframe/types";

type InsightTableContext = {
  baseTable: DataTable;
  joinedTables: Map<UUID, DataTable>;
};

type InsightJoin = NonNullable<Insight["joins"]>[number];

const VALID_JOIN_TYPES = new Set(["inner", "left", "right", "full"]);

function buildResolvedJoinInstances(resolvedFields: Field[]): Set<string> {
  return new Set(
    resolvedFields.flatMap((field) => {
      const components = extractColumnAliasComponents(
        fieldIdToColumnAlias(field.id),
      );
      return components ? [`${field.tableId}:${components.instanceIndex}`] : [];
    }),
  );
}

function findValidJoinFields(
  join: InsightJoin,
  tables: InsightTableContext,
  fieldsByColumnName: Map<string, Field>,
): { joinFields: Field[]; rightKey: string } | null {
  const joinTable = tables.joinedTables.get(join.rightTableId);
  if (!joinTable?.dataFrameId || !VALID_JOIN_TYPES.has(join.type ?? "inner")) {
    return null;
  }

  const joinFields = (joinTable.fields ?? []).filter(
    (field) => !field.name.startsWith("_"),
  );
  const joinKeyField = joinFields.find(
    (field) => (field.columnName ?? field.name) === join.rightKey,
  );
  if (!fieldsByColumnName.has(join.leftKey) || !joinKeyField) return null;

  return {
    joinFields,
    rightKey: joinKeyField.columnName ?? joinKeyField.name,
  };
}

function addJoinFields(
  fieldsByColumnName: Map<string, Field>,
  joinFields: Field[],
  rightKey: string,
) {
  for (const field of joinFields) {
    const columnName = field.columnName ?? field.name;
    if (columnName !== rightKey && !fieldsByColumnName.has(columnName)) {
      fieldsByColumnName.set(columnName, field);
    }
  }
}

/**
 * Build a map of `${rightTableId}:${instanceIndex}` → leftKey in one pass over
 * the joins. The validation mirrors buildInsightAvailableFields so invalid
 * joins do not consume a repeat-join instance.
 */
function buildJoinKeyByInstance(
  joins: NonNullable<Insight["joins"]>,
  resolvedFields: Field[],
  tables: InsightTableContext | undefined,
): Map<string, string> {
  if (!tables) return new Map<string, string>();

  if (!tables.baseTable.dataFrameId || resolvedFields.length === 0) {
    return new Map<string, string>();
  }

  const resolvedJoinInstances = buildResolvedJoinInstances(resolvedFields);

  const fieldsByColumnName = new Map<string, Field>();
  for (const field of tables.baseTable.fields ?? []) {
    if (!field.name.startsWith("_")) {
      fieldsByColumnName.set(field.columnName ?? field.name, field);
    }
  }

  const result = new Map<string, string>();
  const joinInstanceCounts = new Map<UUID, number>();
  for (const join of joins) {
    const validJoin = findValidJoinFields(join, tables, fieldsByColumnName);
    if (!validJoin) continue;

    const instanceIndex = joinInstanceCounts.get(join.rightTableId) ?? 0;
    const instanceKey = `${join.rightTableId}:${instanceIndex}`;
    if (resolvedJoinInstances.has(instanceKey)) {
      result.set(instanceKey, join.leftKey);
    }
    joinInstanceCounts.set(join.rightTableId, instanceIndex + 1);

    addJoinFields(fieldsByColumnName, validJoin.joinFields, validJoin.rightKey);
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
