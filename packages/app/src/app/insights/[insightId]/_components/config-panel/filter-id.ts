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
 * Client `_id` sentinel for a not-yet-saved new-filter draft. Distinguishes a
 * brand-new filter (which must get a fresh identity and append) from an
 * existing row being edited (which must preserve its `_id` so the save routes
 * back to the same predicate — even if the existing filter has no persisted
 * `id`, e.g. one created via the API/agent path).
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
 * - **Existing row** (any other `_id`): preserve `_id` so the save updates the
 *   matching predicate. Backfill a persisted `id` if it lacks one (API/agent
 *   filters), without disturbing the `_id` used for matching.
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
  // Existing row: keep _id for matching; backfill a persisted id if missing.
  return { ...filter, id: filter.id ?? genId() };
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
