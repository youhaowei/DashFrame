import type { DataTable, Field, Insight, UUID } from "@dashframe/types";

/**
 * Resolve the field set a joined insight query will expose, with field ids
 * whose derived column aliases match what the SQL engine emits — so callers can
 * key display-name / type maps on the exact column names DuckDB produces.
 *
 * This MUST track the engine's join-instance counter
 * (`buildJoinedSQL`/`processSingleJoin` in @dashframe/engine) exactly:
 *
 * - Two joins to the same `rightTableId` collide on `field_<uuid>` aliases, so
 *   the engine suffixes repeat instances `field_<uuid>_j{n}` (n≥1). We mirror
 *   that by giving repeat-join fields a synthetic id `<uuid>_j{n}`, which
 *   `fieldIdToColumnAlias` turns into the matching suffixed alias.
 * - The engine SKIPS a join (and does NOT advance its counter) when the join
 *   table has no `dataFrameId` or either join-key column can't be resolved. We
 *   replicate that skip so a skipped first join doesn't push the surviving
 *   repeat-join onto the wrong (`_j1`) alias — keying maps on a column DuckDB
 *   never produced. Drifting these two counters silently loses column headers
 *   and type formatting — the same silent-wrong-column failure the suffixing
 *   exists to prevent, one step removed.
 *
 * Pure (no browser/DuckDB imports) so it can be unit-tested directly; the
 * pagination hook is the only production caller.
 */
export function resolveJoinedFields(
  baseTable: DataTable,
  insight: Pick<Insight, "joins">,
  joinedTables: Map<UUID, DataTable>,
): Field[] {
  const findByColumnName = (fields: Field[], columnName: string) =>
    fields.find((f) => (f.columnName ?? f.name) === columnName);
  const visible = (table: DataTable): Field[] =>
    (table.fields ?? []).filter((f) => !f.name.startsWith("_"));

  const visibleBaseFields = visible(baseTable);
  const allFields: Field[] = [...visibleBaseFields];
  // Accumulating left-side field set the next join keys against — mirrors the
  // engine's `currentFields`; repeat-join fields enter with suffixed ids.
  const accumulatedFields: Field[] = [...visibleBaseFields];
  const joinInstanceCount = new Map<string, number>();

  for (const join of insight.joins ?? []) {
    const joinTable = joinedTables.get(join.rightTableId);
    if (!joinTable || !joinTable.dataFrameId) continue;
    const joinFields = visible(joinTable);
    // Engine key resolution: left key against accumulated fields, right key
    // against this join table's fields. Either missing → engine skips the join
    // and does NOT advance its counter, so neither do we.
    if (
      !findByColumnName(accumulatedFields, join.leftKey) ||
      !findByColumnName(joinFields, join.rightKey)
    ) {
      continue;
    }

    const instanceIndex = joinInstanceCount.get(join.rightTableId) ?? 0;
    joinInstanceCount.set(join.rightTableId, instanceIndex + 1);

    const emittedFields =
      instanceIndex === 0
        ? joinFields // first join: canonical aliases (no suffix)
        : joinFields.map((f) => ({
            ...f,
            id: `${f.id}_j${instanceIndex}` as UUID,
          }));
    allFields.push(...emittedFields);
    accumulatedFields.push(...emittedFields);
  }

  return allFields;
}
