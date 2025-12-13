/**
 * Common result type for query hooks.
 * Matches Convex useQuery pattern for future compatibility.
 */
export interface UseQueryResult<T> {
  /** The data returned by the query, undefined while loading */
  data: T | undefined;
  /** True while the initial load is in progress */
  isLoading: boolean;
}
