export type BrowserAccessResult<TConfig> =
  | { status: "local-ready"; config: TConfig }
  | { status: "admitted"; config: TConfig }
  | { status: "signed-out" }
  | { status: "pending-admission" }
  | { status: "unavailable"; error?: unknown };

export interface BrowserRuntime {
  close(): void | Promise<void>;
}

export type BrowserBootstrapView<TConfig, TRuntime extends BrowserRuntime> =
  | { status: "loading" }
  | { status: "local-ready"; config: TConfig; runtime: TRuntime }
  | { status: "admitted"; config: TConfig; runtime: TRuntime }
  | { status: "signed-out"; onSignIn: () => void }
  | { status: "pending-admission"; onSignOut: () => void }
  | { status: "unavailable"; onRetry: () => void; error?: unknown };

export interface BrowserBootstrapController {
  retry(): Promise<void>;
  teardown(): Promise<void>;
}

export interface BrowserBootstrapDependencies<
  TConfig,
  TRuntime extends BrowserRuntime,
> {
  lookup(signal: AbortSignal): Promise<BrowserAccessResult<TConfig>>;
  createRuntime(
    access: Extract<
      BrowserAccessResult<TConfig>,
      { status: "local-ready" | "admitted" }
    >,
  ): TRuntime | Promise<TRuntime>;
  publish(view: BrowserBootstrapView<TConfig, TRuntime>): void;
  signIn(): void;
  signOut(): void;
}

function isAccessResult<TConfig>(
  value: unknown,
): value is BrowserAccessResult<TConfig> {
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
 * Starts the browser access check and owns every runtime it creates.
 *
 * The caller owns the single React root and maps each published view into it.
 */
export function startBrowserBootstrap<TConfig, TRuntime extends BrowserRuntime>(
  dependencies: BrowserBootstrapDependencies<TConfig, TRuntime>,
): BrowserBootstrapController {
  let generation = 0;
  let stopped = false;
  let lookupAbort: AbortController | undefined;
  let runtime: TRuntime | undefined;
  let teardownPromise: Promise<void> | undefined;
  const runtimeClosures = new WeakMap<TRuntime, Promise<void>>();
  const runtimeAttempts = new Set<Promise<void>>();
  const closingRuntimes = new Set<Promise<void>>();
  const cleanupFailures = new Set<unknown>();

  async function closeRuntime(candidate: TRuntime | undefined): Promise<void> {
    if (!candidate) return;
    const existing = runtimeClosures.get(candidate);
    if (existing) return existing;

    const closing = Promise.resolve().then(() => candidate.close());
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
        "Browser bootstrap failed and the runtime could not be closed",
      );
    }
    if (!isCurrent(attempt)) return;
    dependencies.publish({
      status: "unavailable",
      onRetry: () => void retry(),
      error: unavailableError,
    });
  }

  async function run(attempt: number, signal: AbortSignal): Promise<void> {
    try {
      const result: unknown = await dependencies.lookup(signal);
      if (!isCurrent(attempt)) return;
      if (!isAccessResult<TConfig>(result)) {
        throw new Error("Browser access lookup returned an invalid result");
      }

      if (result.status === "local-ready" || result.status === "admitted") {
        const startingRuntime = (async () => {
          const nextRuntime = await dependencies.createRuntime(result);
          if (!isCurrent(attempt)) {
            await closeRuntime(nextRuntime);
            return;
          }

          const previousRuntime = runtime;
          runtime = nextRuntime;
          await closeRuntime(previousRuntime);
          if (!isCurrent(attempt)) {
            await closeRuntime(nextRuntime);
            return;
          }
          dependencies.publish({ ...result, runtime: nextRuntime });
        })();
        runtimeAttempts.add(startingRuntime);
        startingRuntime.then(
          () => runtimeAttempts.delete(startingRuntime),
          () => runtimeAttempts.delete(startingRuntime),
        );
        await startingRuntime;
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
          return;
        case "unavailable":
          dependencies.publish({
            status: "unavailable",
            onRetry: () => void retry(),
            ...(result.error === undefined ? {} : { error: result.error }),
          });
          return;
      }
    } catch (error) {
      if (!isCurrent(attempt)) return;
      await publishUnavailable(attempt, error);
    }
  }

  function retry(): Promise<void> {
    if (stopped) return Promise.resolve();
    lookupAbort?.abort();
    const abort = new AbortController();
    lookupAbort = abort;
    const attempt = ++generation;
    dependencies.publish({ status: "loading" });
    return run(attempt, abort.signal);
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
          "Failed to close the browser bootstrap runtime",
        );
      }
    })();
    return teardownPromise;
  }

  retry().catch(() => undefined);
  return { retry, teardown };
}
