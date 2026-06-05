/**
 * Common result type for query hooks.
 * Matches Convex useQuery pattern for future compatibility.
 */
export interface UseQueryResult<T> {
  /** The data returned by the query, undefined while loading, and null if the data is not found */
  data: T | undefined;
  /** True while the initial load is in progress (no cached data yet) */
  isLoading: boolean;
  /**
   * True whenever a fetch is in flight — including background refetches after
   * a mutation invalidates the cache.  Use this (rather than isLoading) when
   * you need to know whether the displayed data is fully up-to-date.
   */
  isFetching?: boolean;
}
