import type {
  InsightMetric,
  MeasureExpression,
  Metric,
} from "@dashframe/types";

function references(expression?: MeasureExpression, depth = 0): string[] {
  if (depth > 32) throw new Error("Excessive measure expression depth");
  if (!expression || expression.kind === "constant") return [];
  if (expression.kind === "measure") return [expression.measureId];
  return [
    ...references(expression.left, depth + 1),
    ...references(expression.right, depth + 1),
  ];
}

function rewrite(
  expression: MeasureExpression,
  ids: Map<string, string>,
): MeasureExpression {
  if (expression.kind === "constant") return { ...expression };
  if (expression.kind === "measure") {
    const measureId = ids.get(expression.measureId);
    if (!measureId) throw new Error("Missing reusable measure dependency");
    return { ...expression, measureId };
  }
  return {
    ...expression,
    left: rewrite(expression.left, ids),
    right: rewrite(expression.right, ids),
  };
}

/** Copy a complete dependency graph in dependency-first order, with independent identities. */
function copyMeasures<T extends Metric | InsightMetric>(
  measures: readonly T[],
  rootId: string,
  makeId: () => string,
): T[] {
  const byId = new Map(measures.map((measure) => [measure.id, measure]));
  if (byId.size !== measures.length)
    throw new Error("Duplicate measure identity");
  const visiting = new Set<string>();
  const copied = new Map<string, T>();
  const ids = new Map<string, string>();
  const allocated = new Set(measures.map((measure) => measure.id));
  function visit(id: string, depth: number) {
    if (copied.has(id)) return;
    if (depth > 32 || visiting.has(id))
      throw new Error("Cyclic or excessive measure dependencies");
    const measure = byId.get(id);
    if (!measure) throw new Error(`Missing measure dependency: ${id}`);
    visiting.add(id);
    for (const dependency of references(measure.expression))
      visit(dependency, depth + 1);
    const nextId = makeId();
    if (!nextId || allocated.has(nextId))
      throw new Error("Reusable measure identity must be unique");
    allocated.add(nextId);
    ids.set(id, nextId);
    const copy = structuredClone(measure);
    copy.id = nextId;
    if (measure.expression) copy.expression = rewrite(measure.expression, ids);
    copied.set(id, copy);
    visiting.delete(id);
  }
  visit(rootId, 0);
  return [...copied.values()];
}

/** Save a report measure and its dependencies in the owning source's measure library. */
export function saveReusableMeasure(
  measures: readonly InsightMetric[],
  rootId: string,
  tableId: string,
  makeId: () => string = () => crypto.randomUUID(),
): Metric[] {
  return copyMeasures(measures, rootId, makeId).map(
    ({ sourceTable, ...measure }) => {
      if (sourceTable !== tableId)
        throw new Error(
          "Reusable measures must belong to the same data source",
        );
      return { ...measure, tableId };
    },
  );
}

/** Import a snapshot; later library edits never silently change an existing report. */
export function importReusableMeasure(
  measures: readonly Metric[],
  rootId: string,
  tableId: string,
  makeId: () => string = () => crypto.randomUUID(),
): InsightMetric[] {
  return copyMeasures(measures, rootId, makeId).map(
    ({ tableId: owner, ...measure }) => {
      if (owner !== tableId)
        throw new Error(
          "Reusable measures must belong to the same data source",
        );
      return { ...measure, sourceTable: tableId };
    },
  );
}
