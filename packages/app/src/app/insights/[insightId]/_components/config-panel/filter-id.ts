import type { InsightFilter } from "@dashframe/types";
import type { FilterWithId } from "./FiltersSection";

/**
 * Pure helpers for client-side filter identity and save-merge.
 *
 * Filters carry a persisted `id` (generated on add by FilterEditDialog) that
 * survives persistence round-trips. The client `_id` is sourced from it so a
 * subscription firing mid-edit — which recomputes the filter array, possibly
 * reordered — does not shift identities and misroute an in-flight save.
 */

/** Derive the stable client `_id` from a filter's persisted identity. */
export function deriveFilterId(filter: InsightFilter): string {
  if (!filter.id) {
    throw new Error("Filter is missing its persisted id");
  }
  return filter.id;
}

/**
 * Identity for a stored filter that predates persisted ids.
 *
 * Derived from the predicate's content plus its occurrence position among
 * identical predicates — never from its absolute array index, and never
 * freshly generated: hydration runs again on every refetch, so a random id
 * would differ between the list a dialog was opened from and the list its save
 * merges into, making an existing update look like a missing target.
 *
 * Byte-identical predicates still receive distinct ordinal ids for rendering
 * and removal, but those ordinals identify slots rather than logical rows.
 * Saving a row opened inside such a duplicate set is therefore rejected as
 * ambiguous, even if concurrent deletion later collapses the set to one row.
 * Persisted ids are the only identity strong enough to route an edit through a
 * reorder or deletion. A missing persisted target is also a conflict; only an
 * explicit create intent may append.
 *
 * The `legacy:` prefix distinguishes these fallback identities from freshly
 * generated UUIDs. It is not a marker of being unsaved: saving a legacy row
 * persists this `legacy:` value as its `id`, so a persisted id is not
 * necessarily a UUID.
 */
function legacyFilterId(filter: InsightFilter, occurrence: number): string {
  const value = JSON.stringify(filter.value ?? null);
  return `legacy:${filter.field}:${filter.operator}:${value}#${occurrence}`;
}

/**
 * A persisted id counts only if it is a non-empty string. An empty string is
 * not nullish, so it would slip past a `??` fallback and then fail the
 * emptiness check in `deriveFilterId`, throwing during render. The server
 * rejects such values on write but cannot repair a row already stored with
 * one.
 */
function persistedId(filter: InsightFilter): string | undefined {
  return typeof filter.id === "string" && filter.id.length > 0
    ? filter.id
    : undefined;
}

/** Attach stable client ids to a persisted filter list. */
export function withFilterIds(
  filters: InsightFilter[] | undefined,
): FilterWithId[] {
  const legacyTotals = new Map<string, number>();
  for (const filter of filters ?? []) {
    if (persistedId(filter) !== undefined) continue;
    const base = legacyFilterId(filter, 0);
    legacyTotals.set(base, (legacyTotals.get(base) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return (filters ?? []).map((filter) => {
    // All API write paths stamp this id, so the fallback only covers rows
    // stored before they did.
    const stored = persistedId(filter);
    let id = stored;
    if (id === undefined) {
      const base = legacyFilterId(filter, 0);
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      id = legacyFilterId(filter, occurrence);
    }
    return {
      ...filter,
      id,
      _id: deriveFilterId({ ...filter, id }),
      _legacyFallback: stored === undefined,
      _legacyDuplicate:
        stored === undefined &&
        (legacyTotals.get(legacyFilterId(filter, 0)) ?? 0) > 1,
    };
  });
}

/**
 * Client `_id` sentinel for a not-yet-saved new-filter draft. Distinguishes a
 * brand-new filter (which must get a fresh identity and append) from an
 * existing row being edited (which must preserve its `_id` so the save routes
 * back to the same predicate).
 */
export const NEW_FILTER_ID = "__new__";

/**
 * Stamp a stable identity onto a filter at save time.
 *
 * - **New draft** (`_id === NEW_FILTER_ID`): assign a freshly generated id and
 *   make it the client `_id` too, so `applyFilterSave` appends a distinct row.
 *   Generating the id *here, per save* (not once per dialog mount) is what makes
 *   two consecutive Adds yield two distinct filters instead of the second
 *   overwriting the first.
 * - **Existing row** (any other `_id`): preserve its persisted identity so the
 *   save updates the matching predicate.
 *
 * `genId` is injectable for tests; defaults to `crypto.randomUUID`.
 */
export function prepareFilterForSave(
  filter: FilterWithId,
  genId: () => string = () => crypto.randomUUID(),
): FilterWithId {
  if (filter._id === NEW_FILTER_ID) {
    const id = persistedId(filter) ?? genId();
    return {
      ...filter,
      id,
      _id: id,
      _saveIntent: "create",
      _legacyFallback: false,
      _legacyDuplicate: false,
    };
  }
  return {
    ...filter,
    id: persistedId(filter) ?? filter._id,
    _saveIntent: "update",
  };
}

/**
 * Apply an explicit create/update intent against the latest filter list.
 * Updates require exactly one resolvable target; a concurrent delete or a
 * duplicate id is a conflict rather than permission to append or fan out.
 * Id-less byte-identical legacy rows are also rejected while their identity is
 * still ordinal-derived. Once any canonical write persists those generated ids,
 * the same edit resolves normally by its stable id.
 */
export function applyFilterSave(
  current: FilterWithId[],
  saved: FilterWithId,
): FilterWithId[] {
  const matches = current.filter((filter) => filter._id === saved._id);
  if (matches.length === 0) {
    if (saved._saveIntent === "create") return [...current, saved];
    throw new Error(`Filter ${saved._id} no longer exists`);
  }
  if (matches.length > 1) {
    throw new Error(`Filter ${saved._id} has a duplicate identity`);
  }

  if (saved._legacyFallback && saved._legacyDuplicate) {
    throw new Error(
      "This legacy duplicate filter is ambiguous. Save a separate filter change to migrate stable ids, then retry.",
    );
  }

  if (saved._legacyFallback && matches[0]?._legacyFallback) {
    const ordinalSeparator = saved._id.lastIndexOf("#");
    const identityGroup =
      ordinalSeparator === -1
        ? saved._id
        : saved._id.slice(0, ordinalSeparator + 1);
    const duplicateCount = current.filter(
      (filter) =>
        filter._legacyFallback && filter._id.startsWith(identityGroup),
    ).length;
    if (duplicateCount > 1) {
      throw new Error(
        "This legacy duplicate filter is ambiguous. Save a separate filter change to migrate stable ids, then retry.",
      );
    }
  }

  return current.map((filter) => (filter._id === saved._id ? saved : filter));
}

/** Remove every client-only identity/concurrency marker before persistence. */
export function stripFilterClientMetadata(
  filters: FilterWithId[],
): InsightFilter[] {
  return filters.map(
    ({
      _id: _discardedId,
      _saveIntent: _discardedIntent,
      _legacyFallback: _discardedFallback,
      _legacyDuplicate: _discardedDuplicate,
      ...filter
    }) => filter,
  );
}
