import { fieldIdToColumnAlias } from "@dashframe/engine";
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

function resolveRuntimeFilters(
  insight: Insight,
  availableFields: ReturnType<typeof resolveInsightAvailableFields>,
  overrides: NonNullable<DashboardItemOverrides["filters"]>,
): DashboardRuntimeResolution {
  const values: Record<string, unknown> = {};
  for (const override of overrides) {
    // Shared controls target a field across Insights, whose saved filter IDs
    // differ. Resolve only a unique declared predicate with the same semantics.
    const declarations = (insight.runtimeControls?.filters ?? []).filter(
      (candidate) => {
        if (override.id !== undefined)
          return candidate.filterId === override.id;
        const filter = (insight.filters ?? []).find(
          (saved) => saved.id === candidate.filterId,
        );
        const aliasedField = availableFields.find(
          (field) => fieldIdToColumnAlias(field.id) === filter?.field,
        );
        return (
          (filter?.field === override.field ||
            (aliasedField?.columnName ?? aliasedField?.name) ===
              override.field) &&
          (override.cleared || filter?.operator === override.operator)
        );
      },
    );
    const declaration = declarations[0];
    if (declarations.length !== 1 || !declaration) {
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
  const fields = dataTables.flatMap((table) => table.fields ?? []);
  const sorts = overrides.map((sort) => {
    const fieldId = declaration.allowedFieldIds.find((allowedId) => {
      if (allowedId === sort.field) return true;
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
