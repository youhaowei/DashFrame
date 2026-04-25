/**
 * Renderer-side `Transport` built on the preload bridge. Owns request-id
 * generation and per-subscription observer fanout.
 *
 * The renderer assembles its own ids for invoke calls so it can correlate
 * pending promises if the bridge ever moves to a fire-and-forget model.
 * Today `bridge.invoke` already round-trips via `ipcRenderer.invoke` (which
 * is itself a request/response), but keeping ids end-to-end makes logs
 * traceable across the boundary.
 */
import type { RpcSubscriptionEvent } from "@dashframe/types";

import { TransportError } from "../errors";
import type {
  Subscription,
  SubscriptionObserver,
  Transport,
} from "../transport";
import type { PreloadIpcBridge } from "./preload";

export function createIpcRendererTransport(
  bridge: PreloadIpcBridge,
): Transport {
  let nextReqId = 0;
  const newReqId = () => `req_${nextReqId++}`;

  // Active subscriptions, keyed by the server-assigned subId. Populated
  // when subscribe() resolves; entries are removed when the host emits
  // `error` / `complete` OR the caller calls `close()`.
  const subs = new Map<string, SubscriptionObserver>();

  bridge.onEvent((event: RpcSubscriptionEvent) => {
    const observer = subs.get(event.subId);
    if (!observer) return;
    if (event.kind === "next") {
      observer.next(event.data);
      return;
    }
    if (event.kind === "error") {
      subs.delete(event.subId);
      observer.error(event.error);
      return;
    }
    // complete
    subs.delete(event.subId);
    observer.complete();
  });

  return {
    async invoke(path, args) {
      const id = newReqId();
      const res = await bridge.invoke({ id, path, args });
      if (!res.ok) throw new TransportError(res.error);
      return res.data;
    },

    subscribe(path, args, observer) {
      const reqId = newReqId();
      let subId: string | null = null;
      let closed = false;

      // Future-proofing note: under the WS adapter the `subscribed` ack and
      // the first `next` may race. Today over IPC the subscribe call is a
      // synchronous round-trip so events can't precede the resolve, and the
      // proxy observer below is sufficient. If/when the WS adapter ships,
      // add an event buffer here gated on `subId === null`.
      const proxyObserver: SubscriptionObserver = {
        next: (data) => observer.next(data),
        error: (err) => {
          if (closed) return;
          closed = true;
          observer.error(err);
        },
        complete: () => {
          if (closed) return;
          closed = true;
          observer.complete();
        },
      };

      bridge
        .subscribe({ id: reqId, path, args })
        .then((res) => {
          if (!res.ok) {
            proxyObserver.error(res.error);
            return;
          }
          const data = res.data as { subId?: unknown };
          if (typeof data?.subId !== "string") {
            proxyObserver.error({
              code: "transport",
              message: "subscribe response missing subId",
            });
            return;
          }
          subId = data.subId;
          if (closed) {
            // Caller closed before we got the id — fire-and-forget the
            // unsubscribe so the host can release.
            bridge.unsubscribe({ id: newReqId(), subId }).catch(() => {});
            return;
          }
          subs.set(subId, proxyObserver);
        })
        .catch((err: unknown) => {
          proxyObserver.error({
            code: "transport",
            message: err instanceof Error ? err.message : String(err),
          });
        });

      return {
        get id() {
          return subId ?? reqId;
        },
        get closed() {
          return closed;
        },
        close() {
          if (closed) return;
          closed = true;
          if (subId !== null) {
            subs.delete(subId);
            bridge.unsubscribe({ id: newReqId(), subId }).catch(() => {});
          }
        },
      } satisfies Subscription;
    },
  };
}
