import { getFunctionName, type FunctionReference } from "convex/server";

/** Test fixtures describe visible data; adapt them to native Convex query state. */
export function nativeQueryFixture<T>(result: {
  data?: T;
  isLoading?: boolean;
  isPending?: boolean;
  isError?: boolean;
  isLoadingError?: boolean;
  error?: Error | null;
}) {
  if (result.isLoadingError || (result.isError && result.data === undefined)) {
    return {
      status: "error",
      error: result.error ?? new Error("Query failed"),
    } as const;
  }
  if (result.isPending || result.isLoading || result.data === undefined)
    return { status: "pending" } as const;
  return { status: "success", data: result.data } as const;
}

type FixtureRef = { _path: string };
type QueryFixture = Parameters<typeof nativeQueryFixture>[0];

/** Reuse the UI's semantic fixtures while exercising native hook result shapes. */
export function nativeQueryMock(
  select: (ref: FixtureRef, options?: { args: unknown }) => QueryFixture,
) {
  return function useQueryFixture({
    query,
    args,
  }: {
    query: FunctionReference<"query">;
    args: unknown;
  }) {
    if (args === "skip") return { status: "pending" } as const;
    return nativeQueryFixture(
      select({ _path: getFunctionName(query).split(":").at(-1)! }, { args }),
    );
  };
}

export function nativeMutationMock<T>(
  select: (ref: FixtureRef) => { mutateAsync: T },
) {
  return (ref: FunctionReference<"mutation">) =>
    select({ _path: getFunctionName(ref).split(":").at(-1)! }).mutateAsync;
}

export function hostQueryMock<T>(
  select: (ref: FixtureRef, options?: unknown) => T,
) {
  return (operation: string, options?: unknown) =>
    select({ _path: operation }, options);
}

export function hostMutationMock<T>(select: (ref: FixtureRef) => T) {
  return (operation: string) => select({ _path: operation });
}

/**
 * Both native hook mocks from one fixture. `useArtifactList` reads each list
 * through `useQueries` as page queries; a list fixture is served as one
 * finished page, so the hook resolves it in one render.
 */
export function nativeQueryMocks(
  select: Parameters<typeof nativeQueryMock>[0],
) {
  const queryFixture = nativeQueryMock(select);
  return {
    useQuery_experimental: queryFixture,
    useQueries(
      requests: Record<
        string,
        { query: FunctionReference<"query">; args: unknown }
      >,
    ) {
      const results: Record<string, unknown> = {};
      for (const [name, { query, args }] of Object.entries(requests)) {
        const state = queryFixture({ query, args });
        if (state.status === "error") results[name] = state.error;
        else if (state.status === "success")
          results[name] = {
            page: state.data,
            isDone: true,
            continueCursor: "",
          };
      }
      return results;
    },
  };
}
