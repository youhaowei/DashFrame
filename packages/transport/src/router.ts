/**
 * `Router` is the host-side handler registry. Adapters dispatch into a
 * single shared router so a project can register a handler once and have
 * it reachable from every adapter (loopback for tests, IPC for renderer,
 * future WS for `dashframe serve`).
 *
 * Phase 1 keeps the registry deliberately thin: a path → handler map plus
 * structured-error normalization. It does NOT implement WyStack-style
 * read-set tracking or invalidation-driven re-runs. When the WyStack
 * server transport ships (Phase 2), the router will delegate to
 * `app.call()` and forward `tablesRead` / `tablesWritten` upstream.
 *
 * Subscription model:
 *   - `subscribe(path, args, ctx, observer)` returns a `SubscriptionHandle`
 *     with `.close()` for caller-driven teardown
 *   - the handler's first responsibility is to push an initial `next`;
 *     the router does NOT auto-invoke the matching `query` handler today
 *     — host code (or, in the future, `@wystack/server`) decides when to
 *     emit `next` and when to emit `error`/`complete`
 *   - this keeps the router agnostic to whether subscriptions are reactive
 *     (WyStack) or one-shot push (e.g. progress events for an import)
 */
import type { RpcError } from "@dashframe/types";

import { toTransportError, TransportError } from "./errors";

export interface RouterContext {
  /**
   * Stable identifier for the calling adapter — `"loopback"` for in-memory
   * dispatch, `"ipc"` for Electron IPC, `"ws"` once the WS adapter lands.
   * Handlers can use this to log, gate dev-only paths, or refuse certain
   * calls from untrusted sources.
   */
  source: string;
}

export type RouterHandler = (
  args: unknown,
  ctx: RouterContext,
) => unknown | Promise<unknown>;

export interface SubscriptionHandle {
  readonly id: string;
  /** Push the next value to the observer. No-op once closed. */
  next(data: unknown): void;
  /**
   * Terminal failure. The observer receives `error`, the handle is marked
   * closed, and the host should release any underlying resources.
   */
  fail(error: RpcError): void;
  /**
   * Graceful teardown initiated by the host (e.g. project closing).
   * Observer receives `complete`; further `next` calls are dropped.
   */
  complete(): void;
  readonly closed: boolean;
}

export interface SubscriptionHandler {
  /**
   * Set up the subscription. Returns a teardown function the router calls
   * when the caller (or host) closes the sub. The handler should push the
   * initial value via `handle.next()` synchronously or shortly after — the
   * loopback test harness asserts initial-value delivery.
   */
  (
    args: unknown,
    handle: SubscriptionHandle,
    ctx: RouterContext,
  ): (() => void) | void | Promise<(() => void) | void>;
}

interface InvokeEntry {
  kind: "invoke";
  handler: RouterHandler;
}
interface SubscribeEntry {
  kind: "subscribe";
  handler: SubscriptionHandler;
}
type RouteEntry = InvokeEntry | SubscribeEntry;

export class Router {
  private readonly routes = new Map<string, RouteEntry>();

  /**
   * Register a one-shot handler (query or mutation). Path collisions throw
   * loudly — silent overwrite would mask wiring bugs.
   */
  invoke(path: string, handler: RouterHandler): this {
    this.assertFree(path);
    this.routes.set(path, { kind: "invoke", handler });
    return this;
  }

  /**
   * Register a subscription handler. See `SubscriptionHandler` for the
   * expected lifecycle.
   */
  subscription(path: string, handler: SubscriptionHandler): this {
    this.assertFree(path);
    this.routes.set(path, { kind: "subscribe", handler });
    return this;
  }

  has(path: string): boolean {
    return this.routes.has(path);
  }

  /**
   * Execute an invoke handler. Throws `TransportError` on any failure path:
   * unknown route, wrong route kind (caller used invoke on a sub), or
   * handler exception. Adapters are expected to translate these into the
   * wire envelope (`RpcResponse` with `ok:false`).
   */
  async dispatch(
    path: string,
    args: unknown,
    ctx: RouterContext,
  ): Promise<unknown> {
    const entry = this.routes.get(path);
    if (!entry) {
      throw new TransportError({
        code: "not_found",
        message: `Unknown route: ${path}`,
      });
    }
    if (entry.kind !== "invoke") {
      throw new TransportError({
        code: "transport",
        message: `Route ${path} is a subscription — use subscribe()`,
      });
    }
    try {
      return await entry.handler(args, ctx);
    } catch (err) {
      throw new TransportError(toTransportError(err));
    }
  }

  /**
   * Open a subscription. The router owns the `SubscriptionHandle` lifecycle
   * and observer plumbing; the registered handler returns a teardown
   * function called when the caller closes.
   *
   * If the handler throws synchronously OR rejects, the failure is reported
   * via `observer.error` and the returned handle is already closed. This
   * matches the contract in `Transport.subscribe`: callers never see raw
   * throws, only structured `error` events.
   */
  open(
    path: string,
    args: unknown,
    ctx: RouterContext,
    observer: {
      next: (data: unknown) => void;
      error: (err: RpcError) => void;
      complete: () => void;
    },
    id: string,
  ): SubscriptionHandle {
    const entry = this.routes.get(path);
    if (!entry || entry.kind !== "subscribe") {
      const err: RpcError = entry
        ? {
            code: "transport",
            message: `Route ${path} is not a subscription`,
          }
        : { code: "not_found", message: `Unknown route: ${path}` };
      const handle = makeHandle(id, observer, () => {});
      handle.fail(err);
      return handle;
    }

    let teardown: (() => void) | undefined;
    const handle = makeHandle(id, observer, () => teardown?.());

    Promise.resolve()
      .then(() => entry.handler(args, handle, ctx))
      .then((maybeTeardown) => {
        if (handle.closed) {
          // Caller already closed before setup completed — run teardown
          // immediately so handlers don't leak resources started in their
          // setup body.
          maybeTeardown?.();
          return;
        }
        teardown = maybeTeardown ?? undefined;
      })
      .catch((err: unknown) => {
        handle.fail(toTransportError(err));
      });

    return handle;
  }

  private assertFree(path: string): void {
    if (this.routes.has(path)) {
      throw new Error(`Route already registered: ${path}`);
    }
  }
}

function makeHandle(
  id: string,
  observer: {
    next: (data: unknown) => void;
    error: (err: RpcError) => void;
    complete: () => void;
  },
  releaseResources: () => void,
): SubscriptionHandle {
  let closed = false;
  return {
    id,
    get closed() {
      return closed;
    },
    next(data) {
      if (closed) return;
      observer.next(data);
    },
    fail(error) {
      if (closed) return;
      closed = true;
      try {
        observer.error(error);
      } finally {
        releaseResources();
      }
    },
    complete() {
      if (closed) return;
      closed = true;
      try {
        observer.complete();
      } finally {
        releaseResources();
      }
    },
  };
}
