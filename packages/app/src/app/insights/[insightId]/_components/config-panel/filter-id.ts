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
 * merges into, and `applyFilterSave` would miss and append instead of update.
 *
 * Byte-identical predicates must still get distinct identities. They remain
 * separate list entries, and editing or removing one of them is not the same
 * operation as doing it to both — `applyFilterSave` replaces every `_id` match
 * and `handleRemoveFilter` drops every match, so a shared identity would edit
 * or delete the pair. The occurrence index among *identical* predicates
 * disambiguates them. It is an ordinal assigned by traversal order within the
 * identical group and reassigned on every hydration, so it identifies a SLOT,
 * not a logical row. Reordering or inserting identical predicates can transfer
 * that ordinal to another row. `applyFilterSave` still resolves and replaces
 * one entry rather than appending, but the transfer can become observable
 * after editing, because `map` preserves array position: the changed predicate
 * may land at a different position relative to the non-identical filters
 * around it. `[A, X, A]` reordered to `[A, X, A]` (the two A's swapped) and
 * then saved from an edit opened on the first A yields `[A', X, A]` where
 * following the logical row would have yielded `[A, X, A']`.
 *
 * That ordinal transfer is specific to legacy byte-identical duplicates, and
 * saving any such row promotes a persisted `id`, which closes it for good.
 *
 * The other failure is NOT legacy-specific. `applyFilterSave` appends whenever
 * the current list lacks the saved `_id`, so any concurrent delete of the row
 * being edited — legacy or persisted, duplicate or not — makes the save
 * resurrect it rather than update it. For legacy identities, deleting enough
 * identical members reaches the same state by renumbering. Tracked as issue
 * #309.
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
    return { ...filter, id, _id: deriveFilterId({ ...filter, id }) };
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
    return { ...filter, id, _id: id };
  }
  return { ...filter, id: persistedId(filter) ?? filter._id };
}

/**
 * Merge a saved filter into the current list: replace every row whose `_id`
 * matches, or append if none match.
 *
 * When the persisted id is unique within the current list, it travels with the
 * filter rather than with its index, so a concurrent reorder between open and
 * save cannot misroute the edit. Uniqueness is not enforced:
 * `ensureInsightFilterIds` stamps an id only onto a filter that arrives without
 * one, so a caller that supplies a duplicate keeps it, and a save then rewrites
 * every predicate sharing that id. Legacy identities, duplicate persisted ids,
 * and concurrent deletes are all weaker than the unique-id case — see
 * `legacyFilterId` and issue #309.
 */
export function applyFilterSave(
  current: FilterWithId[],
  saved: FilterWithId,
): FilterWithId[] {
  const exists = current.some((f) => f._id === saved._id);
  return exists
    ? current.map((f) => (f._id === saved._id ? saved : f))
    : [...current, saved];
}
