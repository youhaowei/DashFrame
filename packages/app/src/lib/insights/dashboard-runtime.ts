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
  error?: string;
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
): DashboardRuntimeResolution {
  const values: Record<string, unknown> = {};
  for (const override of overrides) {
    const declaration = resolveOverrideRuntimeFilter(
      insight,
      availableFields,
      override,
    );
    if (!declaration) {
      return { error: "This dashboard filter is not declared by the Insight." };
    }
    values[declaration.key] = override.cleared ? null : override.value;
  }
  return { runtime: { filters: values } };
}

function resolveRuntimeSorts(
  insight: Insight,
  dataTables: readonly DataTable[],
  overrides: NonNullable<DashboardItemOverrides["sorts"]>,
): DashboardRuntimeResolution {
  const declaration = insight.runtimeControls?.sort;
  if (!declaration) {
    return { error: "This dashboard sort is not declared by the Insight." };
  }
  // The host refuses a longer list with a message that names no cause.  Writes
  // reject one now, so this is a list saved before they did.
  if (overrides.length > declaration.maxKeys) {
    return {
      error: `This dashboard sort has ${overrides.length} keys, and the Insight runs ${declaration.maxKeys}.`,
    };
  }
  const fields = dataTables.flatMap((table) => table.fields ?? []);
  const sorts = overrides.map((sort) => {
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
    return fieldId ? { fieldId, direction: sort.direction } : null;
  });
  if (sorts.some((sort) => sort === null)) {
    return {
      error: "This dashboard sort field is not allowed by the Insight.",
    };
  }
  return { runtime: { sort: sorts as InsightRuntimeInput["sort"] } };
}

/**
 * Convert legacy dashboard cell values into the saved Insight's declared
 * runtime-control surface. Undeclared mutations fail visibly instead of
 * silently changing or bypassing the canonical Insight definition.
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
    const resolution = resolveRuntimeFilters(
      insight,
      availableFields,
      overrides.filters,
    );
    if (resolution.error) return resolution;
    runtime.filters = resolution.runtime?.filters;
  }

  if (overrides.sorts !== undefined) {
    const resolution = resolveRuntimeSorts(
      insight,
      dataTables,
      overrides.sorts,
    );
    if (resolution.error) return resolution;
    runtime.sort = resolution.runtime?.sort;
  }

  if (overrides.limit !== undefined) {
    if (!controls?.limit) {
      return { error: "This dashboard limit is not declared by the Insight." };
    }
    runtime.limit = overrides.limit;
  }

  return { runtime };
}
