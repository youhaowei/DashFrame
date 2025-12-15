/**
 * Common result type for query hooks.
 * Matches Convex useQuery pattern for future compatibility.
 */
export interface UseQueryResult<T> {
  /** The data returned by the query, undefined while loading, and null if the data is not found */
  data: T | undefined;
  /** True while the initial load is in progress */
  isLoading: boolean;
}
