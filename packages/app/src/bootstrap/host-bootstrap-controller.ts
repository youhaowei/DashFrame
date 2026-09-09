export type HostAccessResult<TConfig> =
  | { status: "local-ready"; config: TConfig }
  | { status: "admitted"; config: TConfig }
  | { status: "signed-out" }
  | { status: "pending-admission" }
  | { status: "unavailable"; error?: unknown };

export interface ClientRuntime {
  close(): void | Promise<void>;
}

export type HostBootstrapView<TConfig, TRuntime extends ClientRuntime> =
  | { status: "loading" }
  | { status: "local-ready"; config: TConfig; runtime: TRuntime }
  | {
      status: "admitted";
      config: TConfig;
      runtime: TRuntime;
      onSignOut: () => void;
    }
  | { status: "signed-out"; onSignIn: () => void }
  | { status: "pending-admission"; onSignOut: () => void }
  | { status: "unavailable"; onRetry: () => void; error?: unknown };

export interface HostBootstrapController {
  retry(): Promise<void>;
  revalidate(): Promise<void>;
  invalidate(error?: unknown): Promise<void>;
  teardown(): Promise<void>;
}

export interface HostBootstrapDependencies<
  TConfig,
  TRuntime extends ClientRuntime,
> {
  lookup(signal: AbortSignal): Promise<HostAccessResult<TConfig>>;
  createRuntime(
    access: Extract<
      HostAccessResult<TConfig>,
      { status: "local-ready" | "admitted" }
    >,
  ): TRuntime | Promise<TRuntime>;
  publish(view: HostBootstrapView<TConfig, TRuntime>): void;
  beforeClose?(runtime: TRuntime): void;
  sameConfig(left: TConfig, right: TConfig): boolean;
  signIn(): void;
  signOut(): void;
}

function isAccessResult<TConfig>(
  value: unknown,
): value is HostAccessResult<TConfig> {
  if (!value || typeof value !== "object" || !("status" in value)) {
    return false;
  }

  switch (value.status) {
    case "local-ready":
    case "admitted":
      return "config" in value;
    case "signed-out":
    case "pending-admission":
    case "unavailable":
      return true;
    default:
      return false;
  }
}

/**
 * Starts the host access check and owns every runtime it creates.
 *
 * The caller owns the single React root and maps each published view into it.
 */
export function startHostBootstrap<TConfig, TRuntime extends ClientRuntime>(
  dependencies: HostBootstrapDependencies<TConfig, TRuntime>,
): HostBootstrapController {
  let generation = 0;
  let stopped = false;
  let lookupAbort: AbortController | undefined;
  let runtime: TRuntime | undefined;
  let runtimeOwner = 0;
  let readyAccess:
    | Extract<HostAccessResult<TConfig>, { status: "local-ready" | "admitted" }>
    | undefined;
  let teardownPromise: Promise<void> | undefined;
  const runtimeClosures = new WeakMap<TRuntime, Promise<void>>();
  const runtimeAttempts = new Set<Promise<void>>();
  const closingRuntimes = new Set<Promise<void>>();
  const cleanupFailures = new Set<unknown>();

  async function closeRuntime(candidate: TRuntime | undefined): Promise<void> {
    if (!candidate) return;
    const existing = runtimeClosures.get(candidate);
    if (existing) return existing;

    const closing = Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      try {
        dependencies.beforeClose?.(candidate);
      } catch (error) {
        errors.push(error);
      }
      try {
        await candidate.close();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1)
        throw new AggregateError(errors, "Runtime detach and close failed");
    });
    runtimeClosures.set(candidate, closing);
    closingRuntimes.add(closing);
    closing.then(
      () => closingRuntimes.delete(closing),
      (error: unknown) => {
        cleanupFailures.add(error);
        closingRuntimes.delete(closing);
      },
    );
    await closing;
  }

  async function releaseRuntime(): Promise<void> {
    const owned = runtime;
    runtime = undefined;
    readyAccess = undefined;
    await closeRuntime(owned);
  }

  function isCurrent(attempt: number): boolean {
    return !stopped && attempt === generation;
  }

  async function publishUnavailable(
    attempt: number,
    error: unknown,
  ): Promise<void> {
    let unavailableError = error;
    try {
      await releaseRuntime();
    } catch (closeError) {
      unavailableError = new AggregateError(
        [error, closeError],
        "Host bootstrap failed and the runtime could not be closed",
      );
    }
    if (!isCurrent(attempt)) return;
    dependencies.publish({
      status: "unavailable",
      onRetry: () => void retry(),
      error: unavailableError,
    });
  }

  async function run(
    attempt: number,
    signal: AbortSignal,
    retainMatchingRuntime: boolean,
  ): Promise<void> {
    try {
      const result: unknown = await dependencies.lookup(signal);
      if (!isCurrent(attempt)) return;
      if (!isAccessResult<TConfig>(result)) {
        throw new Error("Host access lookup returned an invalid result");
      }

      if (result.status === "local-ready" || result.status === "admitted") {
        if (
          retainMatchingRuntime &&
          runtime &&
          readyAccess?.status === result.status &&
          dependencies.sameConfig(readyAccess.config, result.config)
        ) {
          readyAccess = result;
          runtimeOwner = attempt;
          return;
        }

        const startingRuntime = (async () => {
          const nextRuntime = await dependencies.createRuntime(result);
          if (runtimeClosures.has(nextRuntime)) {
            throw new Error(
              "Runtime factory returned a closing or closed runtime",
            );
          }
          if (!isCurrent(attempt)) {
            if (nextRuntime !== runtime) await closeRuntime(nextRuntime);
            return;
          }

          const previousRuntime = runtime;
          runtime = nextRuntime;
          readyAccess = undefined;
          runtimeOwner = attempt;
          try {
            if (previousRuntime !== nextRuntime)
              await closeRuntime(previousRuntime);
          } finally {
            if (!isCurrent(attempt)) {
              if (nextRuntime === runtime && runtimeOwner === attempt) {
                await releaseRuntime();
              } else if (nextRuntime !== runtime) {
                await closeRuntime(nextRuntime);
              }
            }
          }
          if (!isCurrent(attempt)) return;
          readyAccess = result;
          dependencies.publish(
            result.status === "admitted"
              ? {
                  ...result,
                  runtime: nextRuntime,
                  onSignOut: () => dependencies.signOut(),
                }
              : { ...result, runtime: nextRuntime },
          );
        })();
        runtimeAttempts.add(startingRuntime);
        startingRuntime.then(
          () => runtimeAttempts.delete(startingRuntime),
          () => runtimeAttempts.delete(startingRuntime),
        );
        await startingRuntime;
        return;
      }

      if (result.status === "unavailable") {
        // A revalidation that cannot reach the host is transient, and the
        // session re-checks on a timer and on focus/online/pageshow. Keep the
        // mounted runtime rather than discarding the router, Convex client,
        // query cache and React tree that a recovered host would still serve —
        // on desktop that is the whole workbench, and it cannot be rebuilt.
        // An explicit check (initial load, or Retry) has nothing to keep, and
        // invalidate() is a deliberate signal rather than a failed reach.
        // readyAccess, not just `runtime`: during a handoff `runtime` already
        // points at a replacement that has not been published, and whose
        // superseded attempt will close it — retaining that one would leave the
        // client with no runtime and no view. readyAccess is set only after a
        // successful publish and cleared on release, so it means "mounted".
        if (retainMatchingRuntime && runtime && readyAccess) return;
        await publishUnavailable(attempt, result.error);
        return;
      }
      await releaseRuntime();
      if (!isCurrent(attempt)) return;
      switch (result.status) {
        case "signed-out":
          dependencies.publish({
            status: "signed-out",
            onSignIn: () => dependencies.signIn(),
          });
          return;
        case "pending-admission":
          dependencies.publish({
            status: "pending-admission",
            onSignOut: () => dependencies.signOut(),
          });
      }
    } catch (error) {
      if (!isCurrent(attempt)) return;
      await publishUnavailable(attempt, error);
    }
  }

  function checkAccess(publishLoading: boolean): Promise<void> {
    if (stopped) return Promise.resolve();
    lookupAbort?.abort();
    const abort = new AbortController();
    lookupAbort = abort;
    const attempt = ++generation;
    if (publishLoading) dependencies.publish({ status: "loading" });
    return run(attempt, abort.signal, !publishLoading);
  }

  function retry(): Promise<void> {
    return checkAccess(true);
  }

  function revalidate(): Promise<void> {
    return checkAccess(false);
  }

  async function invalidate(error?: unknown): Promise<void> {
    if (stopped) return;
    lookupAbort?.abort();
    lookupAbort = undefined;
    const attempt = ++generation;
    await publishUnavailable(attempt, error);
  }

  function teardown(): Promise<void> {
    if (teardownPromise) return teardownPromise;
    teardownPromise = (async () => {
      stopped = true;
      generation += 1;
      lookupAbort?.abort();
      lookupAbort = undefined;
      const results = await Promise.allSettled([
        releaseRuntime(),
        ...runtimeAttempts,
        ...closingRuntimes,
      ]);
      const failures = new Set([
        ...cleanupFailures,
        ...results
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason),
      ]);
      if (failures.size > 0) {
        throw new AggregateError(
          failures,
          "Failed to close the host bootstrap runtime",
        );
      }
    })();
    return teardownPromise;
  }

  retry().catch(() => undefined);
  return { retry, revalidate, invalidate, teardown };
}
