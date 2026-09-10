import { describe, expect, it, vi } from "vite-plus/test";

import {
  startHostBootstrap,
  type HostAccessResult,
  type HostBootstrapView,
  type ClientRuntime,
} from "./host-bootstrap-controller";

interface Config {
  identity: string;
  workspaceId: string;
  mode: "local" | "hosted";
  endpoint: string;
}

const defaultConfig: Config = {
  identity: "user-1",
  workspaceId: "workspace-1",
  mode: "hosted",
  endpoint: "https://dashframe.test",
};

function config(overrides: Partial<Config> = {}): Config {
  return { ...defaultConfig, ...overrides };
}

function sameConfig(left: Config, right: Config): boolean {
  return (
    left.identity === right.identity &&
    left.workspaceId === right.workspaceId &&
    left.mode === right.mode &&
    left.endpoint === right.endpoint
  );
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function harness(
  lookup: (signal: AbortSignal) => Promise<HostAccessResult<Config>>,
) {
  const views: HostBootstrapView<Config, ClientRuntime>[] = [];
  const runtimes: ClientRuntime[] = [];
  const createRuntime = vi.fn(() => {
    const runtime = { close: vi.fn(async () => undefined) };
    runtimes.push(runtime);
    return runtime;
  });
  const signIn = vi.fn();
  const signOut = vi.fn();
  const controller = startHostBootstrap({
    lookup,
    createRuntime,
    publish: (view) => views.push(view),
    sameConfig,
    signIn,
    signOut,
  });
  return {
    controller,
    createRuntime,
    runtimes,
    signIn,
    signOut,
    views,
  };
}

describe("browser bootstrap controller", () => {
  it.each(["local-ready", "admitted"] as const)(
    "starts the runtime exactly once for %s access",
    async (status) => {
      const access = { status, config: config() };
      const test = harness(async () => access);

      expect(test.views).toEqual([{ status: "loading" }]);
      await vi.waitFor(() => expect(test.views).toHaveLength(2));

      expect(test.createRuntime).toHaveBeenCalledTimes(1);
      expect(test.createRuntime).toHaveBeenCalledWith(access);
      expect(test.views[1]).toMatchObject({
        status,
        config: access.config,
        runtime: test.runtimes[0],
      });
      if (test.views[1]?.status === "admitted") {
        test.views[1].onSignOut();
        expect(test.signOut).toHaveBeenCalledOnce();
      } else {
        expect(test.views[1]).not.toHaveProperty("onSignOut");
      }
      await test.controller.teardown();
      expect(test.runtimes[0]?.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["signed-out", "pending-admission", "unavailable"] as const)(
    "does not construct a runtime for %s",
    async (status) => {
      const test = harness(async () => ({ status }));

      await vi.waitFor(() => expect(test.views).toHaveLength(2));

      expect(test.createRuntime).not.toHaveBeenCalled();
      expect(test.views[1]?.status).toBe(status);
      if (status === "signed-out") {
        if (test.views[1]?.status !== status) throw new Error("wrong view");
        test.views[1].onSignIn();
        expect(test.signIn).toHaveBeenCalledOnce();
      }
      if (status === "pending-admission") {
        if (test.views[1]?.status !== status) throw new Error("wrong view");
        test.views[1].onSignOut();
        expect(test.signOut).toHaveBeenCalledOnce();
      }
    },
  );

  it("aborts a superseded lookup and discards its late admitted result", async () => {
    const first = deferred<HostAccessResult<Config>>();
    const second = deferred<HostAccessResult<Config>>();
    const signals: AbortSignal[] = [];
    const lookup = vi
      .fn<(signal: AbortSignal) => Promise<HostAccessResult<Config>>>()
      .mockImplementationOnce((signal) => {
        signals.push(signal);
        return first.promise;
      })
      .mockImplementationOnce((signal) => {
        signals.push(signal);
        return second.promise;
      });
    const test = harness(lookup);

    const retry = test.controller.retry();
    expect(signals[0]?.aborted).toBe(true);
    expect(test.views).toEqual([{ status: "loading" }, { status: "loading" }]);

    first.resolve({
      status: "admitted",
      config: config({ endpoint: "https://stale.test" }),
    });
    await first.promise;
    expect(test.createRuntime).not.toHaveBeenCalled();

    second.resolve({ status: "signed-out" });
    await retry;
    expect(test.views.at(-1)?.status).toBe("signed-out");
    expect(test.createRuntime).not.toHaveBeenCalled();
  });

  it("closes the owned runtime once when access is lost", async () => {
    const results: HostAccessResult<Config>[] = [
      { status: "admitted", config: config() },
      { status: "pending-admission" },
    ];
    const test = harness(async () => {
      const result = results.shift();
      if (!result) throw new Error("missing test result");
      return result;
    });
    await vi.waitFor(() => expect(test.views.at(-1)?.status).toBe("admitted"));

    await test.controller.retry();
    await test.controller.teardown();

    expect(test.runtimes[0]?.close).toHaveBeenCalledTimes(1);
    expect(test.views.at(-1)?.status).toBe("pending-admission");
  });

  it("quietly retains a healthy runtime when revalidation returns the same config", async () => {
    const test = harness(async () => ({
      status: "admitted",
      config: config(),
    }));
    await vi.waitFor(() => expect(test.createRuntime).toHaveBeenCalledOnce());
    expect(test.views).toHaveLength(2);

    await test.controller.revalidate();

    expect(test.views).toHaveLength(2);
    expect(test.createRuntime).toHaveBeenCalledTimes(1);
    expect(test.runtimes[0]?.close).not.toHaveBeenCalled();
    await test.controller.teardown();
  });

  it("quietly replaces the runtime when revalidation changes identity", async () => {
    const results: HostAccessResult<Config>[] = [
      { status: "admitted", config: config() },
      {
        status: "admitted",
        config: config({ identity: "user-2", workspaceId: "workspace-2" }),
      },
    ];
    const test = harness(async () => {
      const result = results.shift();
      if (!result) throw new Error("missing test result");
      return result;
    });
    await vi.waitFor(() => expect(test.createRuntime).toHaveBeenCalledOnce());

    await test.controller.revalidate();

    expect(test.views.map((view) => view.status)).toEqual([
      "loading",
      "admitted",
      "admitted",
    ]);
    expect(test.createRuntime).toHaveBeenCalledTimes(2);
    expect(test.runtimes[0]?.close).toHaveBeenCalledTimes(1);
    expect(test.runtimes[1]?.close).not.toHaveBeenCalled();
    await test.controller.teardown();
    expect(test.runtimes[1]?.close).toHaveBeenCalledTimes(1);
  });

  it("keeps an admitted runtime when revalidation cannot reach the host", async () => {
    const results: HostAccessResult<Config>[] = [
      { status: "admitted", config: config() },
      { status: "unavailable" },
      { status: "admitted", config: config() },
    ];
    const test = harness(async () => {
      const result = results.shift();
      if (!result) throw new Error("missing test result");
      return result;
    });
    await vi.waitFor(() => expect(test.createRuntime).toHaveBeenCalledOnce());

    await test.controller.revalidate();

    // The transient failure neither tears the runtime down nor changes the
    // view: a host that comes back is served by the same mounted app.
    expect(test.runtimes[0]?.close).not.toHaveBeenCalled();
    expect(test.views.map((view) => view.status)).toEqual([
      "loading",
      "admitted",
    ]);

    await test.controller.revalidate();
    expect(test.createRuntime).toHaveBeenCalledOnce();
    expect(test.runtimes[0]?.close).not.toHaveBeenCalled();
  });

  it("does not retain a replacement runtime that was never published", async () => {
    // Window: a ready revalidation has swapped `runtime` to B and cleared
    // readyAccess, but is still awaiting A.close(), so nothing is published. A
    // superseding revalidation that reports unavailable must not mistake B for
    // a mounted runtime — the superseded handoff closes B, and retaining would
    // leave the client with no runtime and no view.
    const closeA = deferred<undefined>();
    const views: HostBootstrapView<Config, ClientRuntime>[] = [];
    const runtimes: ClientRuntime[] = [];
    const createRuntime = vi.fn(() => {
      // Only A's close hangs, and the decision is made at creation time: by the
      // time close is called the list already holds both runtimes.
      const isFirst = runtimes.length === 0;
      const runtime = {
        close: vi.fn(() => (isFirst ? closeA.promise : undefined)),
      } as unknown as ClientRuntime;
      runtimes.push(runtime);
      return runtime;
    });
    const results: HostAccessResult<Config>[] = [
      { status: "admitted", config: config() },
      {
        status: "admitted",
        config: config({ endpoint: "https://second.test" }),
      },
      { status: "unavailable" },
    ];
    const controller = startHostBootstrap({
      lookup: async () => {
        const result = results.shift();
        if (!result) throw new Error("missing test result");
        return result;
      },
      createRuntime,
      publish: (view) => views.push(view),
      sameConfig,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    await vi.waitFor(() => expect(createRuntime).toHaveBeenCalledOnce());

    const handoff = controller.revalidate();
    await vi.waitFor(() => expect(createRuntime).toHaveBeenCalledTimes(2));
    await Promise.resolve();

    await controller.revalidate();
    closeA.resolve(undefined);
    await handoff;

    expect(views.at(-1)?.status).toBe("unavailable");
    await controller.teardown().catch(() => undefined);
  });

  it.each(["pending-admission"] as const)(
    "closes an admitted runtime when revalidation reports %s",
    async (status) => {
      const results: HostAccessResult<Config>[] = [
        { status: "admitted", config: config() },
        { status },
      ];
      const test = harness(async () => {
        const result = results.shift();
        if (!result) throw new Error("missing test result");
        return result;
      });
      await vi.waitFor(() => expect(test.createRuntime).toHaveBeenCalledOnce());

      await test.controller.revalidate();

      expect(test.views.map((view) => view.status)).toEqual([
        "loading",
        "admitted",
        status,
      ]);
      expect(test.runtimes[0]?.close).toHaveBeenCalledTimes(1);
    },
  );

  it("discards a stale revalidation superseded by an explicit retry", async () => {
    const revalidation = deferred<HostAccessResult<Config>>();
    const retryResult = deferred<HostAccessResult<Config>>();
    const signals: AbortSignal[] = [];
    const lookup = vi
      .fn<(signal: AbortSignal) => Promise<HostAccessResult<Config>>>()
      .mockImplementationOnce(async (signal) => {
        signals.push(signal);
        return { status: "admitted", config: config() };
      })
      .mockImplementationOnce((signal) => {
        signals.push(signal);
        return revalidation.promise;
      })
      .mockImplementationOnce((signal) => {
        signals.push(signal);
        return retryResult.promise;
      });
    const test = harness(lookup);
    await vi.waitFor(() => expect(test.createRuntime).toHaveBeenCalledOnce());

    const staleRevalidation = test.controller.revalidate();
    const retry = test.controller.retry();
    expect(signals[1]?.aborted).toBe(true);
    revalidation.resolve({
      status: "admitted",
      config: config({ identity: "stale-user" }),
    });
    await staleRevalidation;
    expect(test.createRuntime).toHaveBeenCalledTimes(1);

    retryResult.resolve({ status: "signed-out" });
    await retry;
    expect(test.views.map((view) => view.status)).toEqual([
      "loading",
      "admitted",
      "loading",
      "signed-out",
    ]);
    expect(test.runtimes[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("invalidates an active runtime and discards a pending revalidation", async () => {
    const pendingRevalidation = deferred<HostAccessResult<Config>>();
    const signals: AbortSignal[] = [];
    const lookup = vi
      .fn<(signal: AbortSignal) => Promise<HostAccessResult<Config>>>()
      .mockImplementationOnce(async (signal) => {
        signals.push(signal);
        return { status: "admitted", config: config() };
      })
      .mockImplementationOnce((signal) => {
        signals.push(signal);
        return pendingRevalidation.promise;
      });
    const test = harness(lookup);
    await vi.waitFor(() => expect(test.createRuntime).toHaveBeenCalledOnce());
    const staleRevalidation = test.controller.revalidate();
    const failure = new Error("token response was malformed");

    await test.controller.invalidate(failure);

    expect(signals[1]?.aborted).toBe(true);
    expect(test.runtimes[0]?.close).toHaveBeenCalledTimes(1);
    expect(test.views.at(-1)).toMatchObject({
      status: "unavailable",
      error: failure,
    });
    const viewsAfterInvalidation = test.views.length;
    pendingRevalidation.resolve({
      status: "admitted",
      config: config({ identity: "stale-user" }),
    });
    await staleRevalidation;

    expect(test.createRuntime).toHaveBeenCalledTimes(1);
    expect(test.views).toHaveLength(viewsAfterInvalidation);
    await test.controller.teardown();
    expect(test.runtimes[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight lookup on idempotent teardown", async () => {
    const lookupResult = deferred<HostAccessResult<Config>>();
    let signal: AbortSignal | undefined;
    const test = harness(async (nextSignal) => {
      signal = nextSignal;
      return lookupResult.promise;
    });

    const firstTeardown = test.controller.teardown();
    const secondTeardown = test.controller.teardown();
    expect(secondTeardown).toBe(firstTeardown);
    expect(signal?.aborted).toBe(true);
    await firstTeardown;

    lookupResult.resolve({
      status: "local-ready",
      config: config({ endpoint: "https://late.test" }),
    });
    await lookupResult.promise;
    await Promise.resolve();
    expect(test.createRuntime).not.toHaveBeenCalled();
    expect(test.views).toEqual([{ status: "loading" }]);
  });

  it("waits for an in-flight runtime factory and closes its late runtime once", async () => {
    const runtimeResult = deferred<ClientRuntime>();
    const runtime = { close: vi.fn(async () => undefined) };
    const views: HostBootstrapView<Config, ClientRuntime>[] = [];
    const createRuntime = vi.fn(() => runtimeResult.promise);
    const controller = startHostBootstrap({
      lookup: async () => ({
        status: "admitted" as const,
        config: config(),
      }),
      createRuntime,
      publish: (view) => views.push(view),
      sameConfig,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    await vi.waitFor(() => expect(createRuntime).toHaveBeenCalledOnce());

    let teardownFinished = false;
    const teardown = controller.teardown().then(() => {
      teardownFinished = true;
    });
    await Promise.resolve();
    expect(teardownFinished).toBe(false);

    runtimeResult.resolve(runtime);
    await teardown;
    await controller.teardown();

    expect(runtime.close).toHaveBeenCalledTimes(1);
    expect(views).toEqual([{ status: "loading" }]);
  });

  it("settles every in-flight runtime close before teardown reports a failure", async () => {
    const firstRuntimeResult = deferred<ClientRuntime>();
    const secondRuntimeResult = deferred<ClientRuntime>();
    const runtimeResults = [firstRuntimeResult, secondRuntimeResult];
    const secondClose = deferred<void>();
    const closeFailure = new Error("first close failed");
    const firstRuntime = {
      close: vi.fn(async () => {
        throw closeFailure;
      }),
    };
    const secondRuntime = {
      close: vi.fn(() => secondClose.promise),
    };
    const createRuntime = vi.fn(() => {
      const result = runtimeResults.shift();
      if (!result) throw new Error("missing runtime result");
      return result.promise;
    });
    const controller = startHostBootstrap({
      lookup: async () => ({
        status: "admitted" as const,
        config: config(),
      }),
      createRuntime,
      publish: vi.fn(),
      sameConfig,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    await vi.waitFor(() => expect(createRuntime).toHaveBeenCalledTimes(1));
    controller.retry().catch(() => undefined);
    await vi.waitFor(() => expect(createRuntime).toHaveBeenCalledTimes(2));

    let teardownError: unknown;
    let teardownFinished = false;
    const teardown = controller.teardown().catch((error: unknown) => {
      teardownError = error;
      teardownFinished = true;
    });
    firstRuntimeResult.resolve(firstRuntime);
    secondRuntimeResult.resolve(secondRuntime);
    await vi.waitFor(() => {
      expect(firstRuntime.close).toHaveBeenCalledOnce();
      expect(secondRuntime.close).toHaveBeenCalledOnce();
    });
    expect(teardownFinished).toBe(false);

    secondClose.resolve();
    await teardown;

    expect(teardownError).toBeInstanceOf(AggregateError);
    expect((teardownError as AggregateError).errors).toEqual([closeFailure]);
  });

  it("retains a superseded cleanup rejection for later teardown", async () => {
    const closing = deferred<void>();
    const failure = new Error("close failed before teardown");
    const runtime = { close: vi.fn(() => closing.promise) };
    const views: HostBootstrapView<Config, ClientRuntime>[] = [];
    let admitted = true;
    const controller = startHostBootstrap({
      lookup: async () =>
        admitted
          ? {
              status: "admitted" as const,
              config: config(),
            }
          : { status: "signed-out" as const },
      createRuntime: () => runtime,
      publish: (view) => views.push(view),
      sameConfig,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    await vi.waitFor(() => expect(views.at(-1)?.status).toBe("admitted"));
    admitted = false;
    const losingAccess = controller.retry();
    await vi.waitFor(() => expect(runtime.close).toHaveBeenCalledOnce());
    await controller.retry();
    closing.reject(failure);
    await losingAccess;
    await expect(controller.teardown()).rejects.toMatchObject({
      errors: [failure],
    });
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("preserves lookup and cleanup failures in the unavailable view", async () => {
    const lookupFailure = new Error("lookup failed");
    const closeFailure = new Error("cleanup failed");
    const views: HostBootstrapView<Config, ClientRuntime>[] = [];
    let failLookup = false;
    const controller = startHostBootstrap({
      lookup: async () => {
        if (failLookup) throw lookupFailure;
        return {
          status: "admitted" as const,
          config: config(),
        };
      },
      createRuntime: () => ({
        close: async () => {
          throw closeFailure;
        },
      }),
      publish: (view) => views.push(view),
      sameConfig,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    await vi.waitFor(() => expect(views.at(-1)?.status).toBe("admitted"));
    failLookup = true;
    await controller.retry();
    const view = views.at(-1);
    if (view?.status !== "unavailable") throw new Error("wrong view");
    expect(view.error).toBeInstanceOf(AggregateError);
    expect(view.error).toMatchObject({ errors: [lookupFailure, closeFailure] });
    await expect(controller.teardown()).rejects.toMatchObject({
      errors: [closeFailure],
    });
  });

  it("preserves an explicit unavailable error when owned cleanup fails", async () => {
    const error = new Error("service unavailable");
    const closeError = new Error("close failed");
    const views: HostBootstrapView<Config, ClientRuntime>[] = [];
    let unavailable = false;
    const controller = startHostBootstrap({
      lookup: async () =>
        unavailable
          ? { status: "unavailable" as const, error }
          : {
              status: "admitted" as const,
              config: config(),
            },
      createRuntime: () => ({
        close: async () => {
          throw closeError;
        },
      }),
      publish: (view) => views.push(view),
      sameConfig,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    await vi.waitFor(() => expect(views.at(-1)?.status).toBe("admitted"));
    unavailable = true;
    await controller.retry();
    expect(views.at(-1)).toMatchObject({
      status: "unavailable",
      error: { errors: [error, closeError] },
    });
    await expect(controller.teardown()).rejects.toMatchObject({
      errors: [closeError],
    });
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "cleans a stale handoff with prior rejection %s and next rejection %s",
    async (rejectPrevious, rejectNext) => {
      const previousClose = deferred<void>();
      const previousError = new Error("previous close failed");
      const nextError = new Error("next close failed");
      const hangingLookup = deferred<HostAccessResult<Config>>();
      const previous = { close: vi.fn(() => previousClose.promise) };
      const next = {
        close: vi.fn(async () => {
          if (rejectNext) throw nextError;
        }),
      };
      const views: HostBootstrapView<Config, ClientRuntime>[] = [];
      let lookups = 0;
      let factories = 0;
      const controller = startHostBootstrap({
        lookup: async () =>
          ++lookups === 3
            ? hangingLookup.promise
            : {
                status: "admitted" as const,
                config: config(),
              },
        createRuntime: () => (++factories === 1 ? previous : next),
        publish: (view) => views.push(view),
        sameConfig,
        signIn: vi.fn(),
        signOut: vi.fn(),
      });
      await vi.waitFor(() => expect(views.at(-1)?.status).toBe("admitted"));
      const handoff = controller.retry();
      await vi.waitFor(() => expect(previous.close).toHaveBeenCalledOnce());
      const newer = controller.retry();
      if (rejectPrevious) previousClose.reject(previousError);
      else previousClose.resolve();
      await handoff;
      expect(next.close).toHaveBeenCalledOnce();
      expect(views.at(-1)?.status).toBe("loading");
      const errors = [
        ...(rejectPrevious ? [previousError] : []),
        ...(rejectNext ? [nextError] : []),
      ];
      if (errors.length) {
        await expect(controller.teardown()).rejects.toMatchObject({ errors });
      } else {
        await controller.teardown();
      }
      expect(next.close).toHaveBeenCalledOnce();
      hangingLookup.resolve({ status: "signed-out" });
      await newer;
    },
  );

  it.each(["pending", "completed"] as const)(
    "rejects runtime reuse after %s cleanup",
    async (cleanup) => {
      const closing = deferred<void>();
      const runtime = { close: vi.fn(() => closing.promise) };
      const views: HostBootstrapView<Config, ClientRuntime>[] = [];
      let admitted = true;
      const controller = startHostBootstrap({
        lookup: async () =>
          admitted
            ? {
                status: "admitted" as const,
                config: config(),
              }
            : { status: "signed-out" as const },
        createRuntime: () => runtime,
        publish: (view) => views.push(view),
        sameConfig,
        signIn: vi.fn(),
        signOut: vi.fn(),
      });
      await vi.waitFor(() => expect(views.at(-1)?.status).toBe("admitted"));
      admitted = false;
      const loss = controller.retry();
      await vi.waitFor(() => expect(runtime.close).toHaveBeenCalledOnce());
      if (cleanup === "completed") {
        closing.resolve();
        await loss;
      }
      admitted = true;
      await controller.retry();
      const view = views.at(-1);
      if (view?.status !== "unavailable")
        throw new Error("closing runtime was admitted");
      expect(view.error).toMatchObject({
        message: "Runtime factory returned a closing or closed runtime",
      });
      expect(views.filter((entry) => entry.status === "admitted")).toHaveLength(
        1,
      );
      closing.resolve();
      await loss;
      await controller.teardown();
      expect(runtime.close).toHaveBeenCalledOnce();
    },
  );

  it("keeps a memoized owned runtime open across ready retries", async () => {
    const runtime = { close: vi.fn(async () => undefined) };
    const views: HostBootstrapView<Config, ClientRuntime>[] = [];
    const controller = startHostBootstrap({
      lookup: async () => ({
        status: "admitted" as const,
        config: config(),
      }),
      createRuntime: () => runtime,
      publish: (view) => views.push(view),
      sameConfig,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    await vi.waitFor(() => expect(views.at(-1)?.status).toBe("admitted"));
    await controller.retry();
    expect(views.at(-1)).toMatchObject({ status: "admitted", runtime });
    expect(runtime.close).not.toHaveBeenCalled();
    await controller.teardown();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "closes despite a detach failure, close rejects %s",
    async (rejectClose) => {
      const detachError = new Error("detach failed");
      const closeError = new Error("close failed");
      const runtime = {
        close: vi.fn(async () => {
          if (rejectClose) throw closeError;
        }),
      };
      const views: HostBootstrapView<Config, ClientRuntime>[] = [];
      const controller = startHostBootstrap({
        lookup: async () => ({ status: "admitted" as const, config: config() }),
        createRuntime: () => runtime,
        publish: (view) => views.push(view),
        beforeClose: () => {
          throw detachError;
        },
        sameConfig,
        signIn: vi.fn(),
        signOut: vi.fn(),
      });
      await vi.waitFor(() => expect(views.at(-1)?.status).toBe("admitted"));
      const teardown = controller.teardown();
      await expect(teardown).rejects.toMatchObject({
        errors: rejectClose
          ? [{ errors: [detachError, closeError] }]
          : [detachError],
      });
      expect(runtime.close).toHaveBeenCalledOnce();
      expect(controller.teardown()).toBe(teardown);
    },
  );

  it("preserves an explicit unavailable error payload", async () => {
    const error = new Error("service unavailable");
    const test = harness(async () => ({ status: "unavailable", error }));
    await vi.waitFor(() =>
      expect(test.views.at(-1)?.status).toBe("unavailable"),
    );
    expect(test.views.at(-1)).toMatchObject({ error });
    await test.controller.teardown();
  });

  it.each([
    ["rejected", async () => Promise.reject(new Error("offline"))],
    ["malformed", async () => ({ status: "unexpected" })],
  ] as const)(
    "publishes unavailable when lookup is %s",
    async (_name, lookup) => {
      const test = harness(
        lookup as (signal: AbortSignal) => Promise<HostAccessResult<Config>>,
      );

      await vi.waitFor(() => expect(test.views).toHaveLength(2));

      expect(test.createRuntime).not.toHaveBeenCalled();
      expect(test.views[1]?.status).toBe("unavailable");
    },
  );
});
