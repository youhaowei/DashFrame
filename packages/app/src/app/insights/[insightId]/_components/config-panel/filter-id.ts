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

/** Derive the stable client `_id` for a persisted filter at array position i. */
export function deriveFilterId(filter: InsightFilter, index: number): string {
  // Persisted id is the stable identity. Filters from the API/agent path may
  // lack one; fall back to a content+index key (not edited concurrently).
  return filter.id ?? `${filter.field}-${filter.operator}-${index}`;
}

/** Attach stable client ids to a persisted filter list. */
export function withFilterIds(
  filters: InsightFilter[] | undefined,
): FilterWithId[] {
  return (filters ?? []).map((f, i) => ({ ...f, _id: deriveFilterId(f, i) }));
}

/**
 * Stamp a stable identity onto a filter at save time.
 *
 * A new filter (no persisted `id`) is assigned a freshly generated id, which
 * also becomes its client `_id`. An existing filter keeps its `id` and `_id`,
 * so edits route back to the same predicate. Generating the id *here, per save*
 * (rather than once per dialog mount) is what makes two consecutive Adds yield
 * two distinct filters instead of the second overwriting the first.
 *
 * `genId` is injectable for tests; defaults to `crypto.randomUUID`.
 */
export function prepareFilterForSave(
  filter: FilterWithId,
  genId: () => string = () => crypto.randomUUID(),
): FilterWithId {
  const id = filter.id ?? genId();
  return { ...filter, id, _id: filter.id ? filter._id : id };
}

/**
 * Merge a saved filter into the current list: update the row whose `_id`
 * matches, else append. Matching on the persisted-id-derived `_id` means a
 * concurrent reorder between open and save cannot route the edit to the wrong
 * predicate — the id travels with the filter, not its index.
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
