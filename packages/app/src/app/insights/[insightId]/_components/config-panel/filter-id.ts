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
