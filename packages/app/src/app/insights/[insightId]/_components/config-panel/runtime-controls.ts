import type {
  InsightFilter,
  InsightRuntimeDeclaration,
  UUID,
} from "@dashframe/types";

/** Compare persisted values independently of Convex's canonical key ordering. */
export function stableValueSignature(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableValueSignature).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    // Convex drops undefined-valued keys, so they must not affect equality
    // with the server echo.
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${stableValueSignature(entry)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

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
