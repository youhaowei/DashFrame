import type {
  InsightFilter,
  InsightRuntimeDeclaration,
  UUID,
} from "@dashframe/types";

export function pruneRuntimeControls(
  declaration: InsightRuntimeDeclaration | undefined,
  filters: readonly InsightFilter[],
  resultFieldIds: readonly UUID[],
): InsightRuntimeDeclaration | undefined {
  if (!declaration) return undefined;
  const filterIds = new Set(
    filters.flatMap((filter) => (filter.id ? [filter.id] : [])),
  );
  const fields = new Set(resultFieldIds);
  const next: InsightRuntimeDeclaration = {
    filters: declaration.filters?.filter((control) =>
      filterIds.has(control.filterId),
    ),
    sort: declaration.sort
      ? {
          ...declaration.sort,
          allowedFieldIds: declaration.sort.allowedFieldIds.filter((id) =>
            fields.has(id),
          ),
        }
      : undefined,
    limit: declaration.limit,
  };
  if (next.filters?.length === 0) delete next.filters;
  if (next.sort?.allowedFieldIds.length === 0) delete next.sort;
  return next.filters || next.sort || next.limit ? next : undefined;
}
