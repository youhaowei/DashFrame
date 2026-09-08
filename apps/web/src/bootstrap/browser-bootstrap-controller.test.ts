import { describe, expect, it, vi } from "vite-plus/test";

import {
  startBrowserBootstrap,
  type BrowserAccessResult,
  type BrowserBootstrapView,
  type BrowserRuntime,
} from "./browser-bootstrap-controller";

interface Config {
  url: string;
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
  lookup: (signal: AbortSignal) => Promise<BrowserAccessResult<Config>>,
) {
  const views: BrowserBootstrapView<Config, BrowserRuntime>[] = [];
  const runtimes: BrowserRuntime[] = [];
  const createRuntime = vi.fn(() => {
    const runtime = { close: vi.fn(async () => undefined) };
    runtimes.push(runtime);
    return runtime;
  });
  const signIn = vi.fn();
  const signOut = vi.fn();
  const controller = startBrowserBootstrap({
    lookup,
    createRuntime,
    publish: (view) => views.push(view),
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
      const access = { status, config: { url: "https://dashframe.test" } };
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
    const first = deferred<BrowserAccessResult<Config>>();
    const second = deferred<BrowserAccessResult<Config>>();
    const signals: AbortSignal[] = [];
    const lookup = vi
      .fn<(signal: AbortSignal) => Promise<BrowserAccessResult<Config>>>()
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
      config: { url: "https://stale.test" },
    });
    await first.promise;
    expect(test.createRuntime).not.toHaveBeenCalled();

    second.resolve({ status: "signed-out" });
    await retry;
    expect(test.views.at(-1)?.status).toBe("signed-out");
    expect(test.createRuntime).not.toHaveBeenCalled();
  });

  it("closes the owned runtime once when access is lost", async () => {
    const results: BrowserAccessResult<Config>[] = [
      { status: "admitted", config: { url: "https://dashframe.test" } },
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

  it("aborts an in-flight lookup on idempotent teardown", async () => {
    const lookupResult = deferred<BrowserAccessResult<Config>>();
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
      config: { url: "https://late.test" },
    });
    await lookupResult.promise;
    await Promise.resolve();
    expect(test.createRuntime).not.toHaveBeenCalled();
    expect(test.views).toEqual([{ status: "loading" }]);
  });

  it("waits for an in-flight runtime factory and closes its late runtime once", async () => {
    const runtimeResult = deferred<BrowserRuntime>();
    const runtime = { close: vi.fn(async () => undefined) };
    const views: BrowserBootstrapView<Config, BrowserRuntime>[] = [];
    const createRuntime = vi.fn(() => runtimeResult.promise);
    const controller = startBrowserBootstrap({
      lookup: async () => ({
        status: "admitted" as const,
        config: { url: "https://dashframe.test" },
      }),
      createRuntime,
      publish: (view) => views.push(view),
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
    const firstRuntimeResult = deferred<BrowserRuntime>();
    const secondRuntimeResult = deferred<BrowserRuntime>();
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
    const controller = startBrowserBootstrap({
      lookup: async () => ({
        status: "admitted" as const,
        config: { url: "https://dashframe.test" },
      }),
      createRuntime,
      publish: vi.fn(),
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
    const views: BrowserBootstrapView<Config, BrowserRuntime>[] = [];
    let admitted = true;
    const controller = startBrowserBootstrap({
      lookup: async () =>
        admitted
          ? {
              status: "admitted" as const,
              config: { url: "https://dashframe.test" },
            }
          : { status: "signed-out" as const },
      createRuntime: () => runtime,
      publish: (view) => views.push(view),
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
    const views: BrowserBootstrapView<Config, BrowserRuntime>[] = [];
    let failLookup = false;
    const controller = startBrowserBootstrap({
      lookup: async () => {
        if (failLookup) throw lookupFailure;
        return {
          status: "admitted" as const,
          config: { url: "https://dashframe.test" },
        };
      },
      createRuntime: () => ({
        close: async () => {
          throw closeFailure;
        },
      }),
      publish: (view) => views.push(view),
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
        lookup as (signal: AbortSignal) => Promise<BrowserAccessResult<Config>>,
      );

      await vi.waitFor(() => expect(test.views).toHaveLength(2));

      expect(test.createRuntime).not.toHaveBeenCalled();
      expect(test.views[1]?.status).toBe("unavailable");
    },
  );
});
