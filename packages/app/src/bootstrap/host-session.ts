import {
  startHostBootstrap,
  type HostBootstrapView,
  type ClientRuntime,
} from "./host-bootstrap-controller";
import {
  lookupHostRuntime,
  sameHostRuntime,
  type HostRuntimeConfig,
} from "./runtime-transport";

export function startHostSession<TRuntime extends ClientRuntime>(options: {
  hostUrl: string;
  /** Client credential for this host; omitted by browser clients on a cookie session. */
  token?: string;
  createRuntime(
    config: HostRuntimeConfig,
    onAccessInvalidated: (reason: "denied" | "unavailable") => void,
  ): TRuntime | Promise<TRuntime>;
  publish(view: HostBootstrapView<HostRuntimeConfig, TRuntime>): void;
  unmount(): void;
  events?: Window;
}) {
  const events = options.events ?? window;
  let stopped = false;
  let signingOut = false;
  const actionAbort = new AbortController();
  let visibleRuntime: TRuntime | undefined;
  const controller = startHostBootstrap({
    lookup: (signal) =>
      lookupHostRuntime(options.hostUrl, signal, { token: options.token }),
    sameConfig: sameHostRuntime,
    createRuntime: (access) =>
      options.createRuntime(access.config, (reason) => {
        if (stopped) return;
        if (reason === "denied") return controller.revalidate();
        return controller.invalidate();
      }),
    publish(view) {
      visibleRuntime =
        view.status === "admitted" || view.status === "local-ready"
          ? view.runtime
          : undefined;
      options.publish(view);
    },
    beforeClose(runtime) {
      if (visibleRuntime !== runtime || stopped) return;
      visibleRuntime = undefined;
      options.publish({ status: "loading" });
    },
    signIn: () =>
      events.location.assign(new URL("/auth/login", options.hostUrl).href),
    signOut: () => {
      void signOut();
    },
  });
  async function signOut() {
    if (stopped || signingOut) return;
    signingOut = true;
    try {
      const response = await fetch(new URL("/auth/logout", options.hostUrl), {
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        signal: actionAbort.signal,
      });
      if (response.status !== 204 || response.redirected)
        throw new Error("Sign out failed");
      if (!stopped) await controller.retry();
    } catch (error) {
      if (!stopped) await controller.invalidate(error);
    } finally {
      signingOut = false;
    }
  }
  const recheck = () => {
    if (!stopped && !signingOut) return controller.revalidate();
  };
  const timer = setInterval(recheck, 30_000);
  events.addEventListener("focus", recheck);
  events.addEventListener("online", recheck);
  events.addEventListener("pageshow", recheck);
  const pagehide = (event: PageTransitionEvent) => {
    if (!event.persisted) void teardown();
  };
  events.addEventListener("pagehide", pagehide);
  let teardownPromise: Promise<void> | undefined;
  function teardown() {
    if (teardownPromise) return teardownPromise;
    stopped = true;
    clearInterval(timer);
    actionAbort.abort();
    events.removeEventListener("focus", recheck);
    events.removeEventListener("online", recheck);
    events.removeEventListener("pageshow", recheck);
    events.removeEventListener("pagehide", pagehide);
    options.unmount();
    teardownPromise = controller.teardown();
    return teardownPromise;
  }
  return { teardown };
}
