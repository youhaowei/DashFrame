type QueryState<T> =
  | { status: "pending" }
  | { status: "success"; data: T }
  | { status: "error"; error: Error };

/** Translate Convex's native query state into the presentation flags used by the UI. */
export function queryStatus<T>(result: QueryState<T>) {
  const data = result.status === "success" ? result.data : undefined;
  const error = result.status === "error" ? result.error : null;
  return {
    data,
    error,
    isLoading: result.status === "pending",
    isPending: result.status === "pending",
    isFetching: result.status === "pending",
    isError: result.status === "error",
    isLoadingError: result.status === "error",
  };
}
