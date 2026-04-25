/**
 * `LoopbackTransport` — same-process `Transport` that dispatches directly
 * into a `Router`, with no IPC, no serialization, and no async deferral
 * beyond what the router itself needs.
 *
 * Used by:
 *   - unit tests that want to exercise handler logic without spinning up
 *     Electron
 *   - same-process callers in the future server runtime (e.g. `dashframe
 *     serve`'s admin tooling reaching into its own router)
 *
 * Behaviorally identical to a perfect IPC adapter:
 *   - `invoke` resolves with the handler's return; rejects with
 *     `TransportError` on any failure
 *   - `subscribe` returns a closable `Subscription`, observer receives
 *     `next` / `error` / `complete`
 *   - subscription `id`s are monotonically generated so test logs are
 *     stable
 */
import { TransportError } from "./errors";
import { Router } from "./router";
import type {
  Subscription,
  SubscriptionObserver,
  Transport,
} from "./transport";

export interface LoopbackTransportOptions {
  /** Override the source tag passed to handlers; defaults to `"loopback"`. */
  source?: string;
}

export class LoopbackTransport implements Transport {
  private readonly source: string;
  private nextId = 0;

  constructor(
    private readonly router: Router,
    options: LoopbackTransportOptions = {},
  ) {
    this.source = options.source ?? "loopback";
  }

  async invoke(path: string, args?: unknown): Promise<unknown> {
    return this.router.dispatch(path, args, { source: this.source });
  }

  subscribe(
    path: string,
    args: unknown,
    observer: SubscriptionObserver,
  ): Subscription {
    const id = `sub_${this.nextId++}`;
    const handle = this.router.open(
      path,
      args,
      { source: this.source },
      observer,
      id,
    );
    return {
      id,
      get closed() {
        return handle.closed;
      },
      close() {
        if (handle.closed) return;
        handle.complete();
      },
    };
  }
}

export function createLoopbackTransport(
  router: Router,
  options?: LoopbackTransportOptions,
): LoopbackTransport {
  return new LoopbackTransport(router, options);
}

// Re-export for convenience: callers using only the loopback rarely need
// to import the error class from `@dashframe/transport` separately.
export { TransportError };
