import { fieldIdToColumnAlias, metricIdToColumnAlias } from "@dashframe/engine";
import type {
  DashboardItemOverrides,
  DataTable,
  Insight,
  InsightRuntimeInput,
} from "@dashframe/types";

import { resolveInsightAvailableFields } from "@/lib/insights/compute-combined-fields";

export type DashboardRuntimeResolution = {
  runtime?: InsightRuntimeInput;
};

export type RuntimeFilterDeclaration = NonNullable<
  NonNullable<Insight["runtimeControls"]>["filters"]
>[number];

/** A field as a filter may name it: by column name, or by result-column alias. */
export type NamedField = { id: string; name: string; columnName?: string };

/**
 * Whether a saved filter is on the field an override names.  An override names
 * a field by column name; a saved filter may store its field that way or as
 * the field's result-column alias.
 */
export function savedFilterIsOn(
  savedField: string | undefined,
  fieldName: string,
  availableFields: readonly NamedField[],
): boolean {
  if (savedField === fieldName) return true;
  const aliasedField = availableFields.find(
    (field) => fieldIdToColumnAlias(field.id) === savedField,
  );
  return (aliasedField?.columnName ?? aliasedField?.name) === fieldName;
}

/**
 * The declared runtime filter a tile filter override runs through, or
 * undefined when none, or more than one, matches.
 *
 * An override that carries the saved filter's id names its declaration.  One
 * without an id is matched by field and operator: shared controls target a
 * field across Insights, whose saved filter ids differ, so only a unique
 * declared predicate with the same semantics is taken.  A saved filter may
 * name its field by column name or by result-column alias.
 *
 * The override popover asks this too, so a row never calls an override
 * undeclared that the tile runs, or the reverse.
 */
export function resolveOverrideRuntimeFilter(
  insight: Pick<Insight, "filters" | "runtimeControls">,
  availableFields: readonly NamedField[],
  override: Pick<
    NonNullable<DashboardItemOverrides["filters"]>[number],
    "id" | "field" | "operator" | "cleared"
  >,
): RuntimeFilterDeclaration | undefined {
  const declarations = (insight.runtimeControls?.filters ?? []).filter(
    (candidate) => {
      if (override.id !== undefined) return candidate.filterId === override.id;
      const filter = (insight.filters ?? []).find(
        (saved) => saved.id === candidate.filterId,
      );
      return (
        savedFilterIsOn(filter?.field, override.field, availableFields) &&
        (override.cleared || filter?.operator === override.operator)
      );
    },
  );
  return declarations.length === 1 ? declarations[0] : undefined;
}

function resolveRuntimeFilters(
  insight: Insight,
  availableFields: ReturnType<typeof resolveInsightAvailableFields>,
  overrides: NonNullable<DashboardItemOverrides["filters"]>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const override of overrides) {
    const declaration = resolveOverrideRuntimeFilter(
      insight,
      availableFields,
      override,
    );
    if (declaration)
      values[declaration.key] = override.cleared ? null : override.value;
  }
  return values;
}

/**
 * Whether a tile can sort by the allowed field or metric `id`.
 *
 * On a pivoted Insight a metric is one column per pivot value.  The host sorts
 * a tile by the cell the Insight's own saved sort on that metric names, and
 * refuses a metric that has no such sort, so only metrics with one can run.
 */
export function tileSortRuns(
  insight: Pick<Insight, "metrics" | "sorts" | "reporting">,
  id: string,
): boolean {
  const pivotFields = insight.reporting?.pivotFields ?? [];
  if (!pivotFields.length || !insight.metrics.some((m) => m.id === id))
    return true;
  return (insight.sorts ?? []).some((sort) => {
    if (sort.field !== id && sort.field !== metricIdToColumnAlias(id))
      return false;
    const tuple = sort.pivotValues?.map((value) => value.fieldId) ?? [];
    return (
      tuple.length === pivotFields.length &&
      new Set(tuple).size === tuple.length &&
      pivotFields.every((fieldId) => tuple.includes(fieldId))
    );
  });
}

/**
 * The runtime sort a tile's sort override asks for, or undefined when it asks
 * for none the tile can run.
 *
 * Writes refuse a sort override the Insight does not declare, allow, or run,
 * and one with more than one key.  One saved before they did is not an error:
 * the tile runs its first key when that key can run, and otherwise ignores it.
 */
function resolveRuntimeSort(
  insight: Insight,
  dataTables: readonly DataTable[],
  overrides: NonNullable<DashboardItemOverrides["sorts"]>,
): InsightRuntimeInput["sort"] {
  const declaration = insight.runtimeControls?.sort;
  const sort = overrides[0];
  if (!declaration || !sort) return undefined;
  const fields = dataTables.flatMap((table) => table.fields ?? []);
  const fieldId = declaration.allowedFieldIds.find((allowedId) => {
    // An allowed id may be stored as itself or as the result-column alias
    // the Insight's own sorts use for it.  Both alias forms are checked for
    // every id: a column selected from an upstream insight keeps that
    // insight's metric id but is aliased as a field.
    if (
      allowedId === sort.field ||
      fieldIdToColumnAlias(allowedId) === sort.field ||
      metricIdToColumnAlias(allowedId) === sort.field
    )
      return true;
    const field = fields.find((candidate) => candidate.id === allowedId);
    if (field) return (field.columnName ?? field.name) === sort.field;
    const metric = insight.metrics.find(
      (candidate) => candidate.id === allowedId,
    );
    return metric
      ? metric.name === sort.field || metric.columnName === sort.field
      : false;
  });
  return fieldId && tileSortRuns(insight, fieldId)
    ? [{ fieldId, direction: sort.direction }]
    : undefined;
}

/**
 * Convert a tile's overrides into the saved Insight's declared runtime-control
 * surface.
 *
 * A tile never fails to render because of an override it holds.  Writes
 * refuse an override the Insight does not declare, but one saved before they
 * did, or before the Insight dropped the control, is ignored here and the
 * tile runs the Insight's own setting instead.
 */
export function resolveDashboardRuntime(
  insight: Insight,
  dataTables: readonly DataTable[],
  overrides: DashboardItemOverrides | undefined,
  insights: readonly Insight[] = [],
): DashboardRuntimeResolution {
  if (!overrides) return {};
  const controls = insight.runtimeControls;
  const runtime: InsightRuntimeInput = {};

  if (overrides.filters !== undefined) {
    const availableFields = resolveInsightAvailableFields(
      insight,
      [...dataTables],
      [...insights],
    );
    runtime.filters = resolveRuntimeFilters(
      insight,
      availableFields,
      overrides.filters,
    );
  }

  if (overrides.sorts !== undefined) {
    const sort = resolveRuntimeSort(insight, dataTables, overrides.sorts);
    if (sort) runtime.sort = sort;
  }

  // The host refuses a limit outside the range the Insight offers viewers.
  const limit = overrides.limit;
  if (
    limit !== undefined &&
    controls?.limit &&
    limit >= controls.limit.min &&
    limit <= controls.limit.max
  )
    runtime.limit = limit;

  return { runtime };
}
