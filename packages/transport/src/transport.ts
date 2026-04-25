/**
 * The `Transport` is the single contract every adapter implements. Two
 * methods, both async-friendly, both returning structured errors at the
 * boundary rather than throwing transport-internal failures.
 *
 * `invoke` covers both queries and mutations — Phase 1 does not distinguish
 * at the wire layer (the router knows the difference). Server-driven push
 * is layered on top via `subscribe`, which returns a `Subscription` handle
 * the caller is responsible for closing.
 *
 * Subscription lifecycle is intentionally caller-driven (no automatic
 * cleanup on host teardown beyond the `complete` event). A renderer that
 * navigates away should `close()` its subs; reload events drop the underlying
 * IPC socket and the main process clears the registry.
 */
import type { RpcError } from "@dashframe/types";

export interface SubscriptionObserver {
  next: (data: unknown) => void;
  error: (error: RpcError) => void;
  complete: () => void;
}

export interface Subscription {
  /** Server-assigned id; useful for logging and test assertions. */
  readonly id: string;
  /** Tear down. Idempotent — second call is a no-op. */
  close(): void;
  /** Whether `close()` has run (or the host sent `complete`/`error`). */
  readonly closed: boolean;
}

export interface Transport {
  /**
   * Call a registered handler once. Resolves with the data on success;
   * rejects with a `TransportError` (carrying a tagged `RpcError`) on
   * failure. Implementations MUST surface handler errors as
   * `TransportError`s — never as raw exceptions — so callers have a stable
   * boundary type.
   */
  invoke(path: string, args?: unknown): Promise<unknown>;

  /**
   * Open a subscription. The observer's `next` is called for the initial
   * value AND every subsequent invalidation (Phase 1: re-runs are host-
   * driven; today no host pushes invalidations, but the contract is in
   * place). `error` is terminal; `complete` is sent on host-side teardown.
   */
  subscribe(
    path: string,
    args: unknown,
    observer: SubscriptionObserver,
  ): Subscription;
}
