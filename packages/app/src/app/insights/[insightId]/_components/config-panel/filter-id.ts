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

/** Attach stable client ids to a persisted filter list. */
export function withFilterIds(
  filters: InsightFilter[] | undefined,
): FilterWithId[] {
  return (filters ?? []).map((filter) => {
    // All API write paths persist this id. This defensive hydration only keeps
    // legacy rows usable until their next save; it never derives identity from
    // content or array position.
    const id = filter.id ?? crypto.randomUUID();
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
    const id = filter.id ?? genId();
    return { ...filter, id, _id: id };
  }
  return { ...filter, id: filter.id ?? filter._id };
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
