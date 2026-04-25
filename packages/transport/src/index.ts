/**
 * @dashframe/transport — single RPC surface for the DashFrame v0.2 stack.
 *
 * Why a transport package:
 *   - main↔renderer (Electron IPC) and standalone↔web (future WebSocket)
 *     should share one client contract; the renderer should not care which
 *     adapter is wired underneath
 *   - the host process owns a `Router` of handlers; every adapter is a thin
 *     dispatcher into that router
 *   - same-process callers (unit tests, future server-side tooling) get a
 *     `LoopbackTransport` that skips serialization entirely
 *
 * Layout:
 *   - `Transport` (this file) — interface every client implements
 *   - `Router` — handler registry shared by all adapters
 *   - `LoopbackTransport` — direct dispatch into a `Router`
 *   - `ipc/main` — `ipcMain` wiring around a `Router`
 *   - `ipc/preload` — `contextBridge` shim mapping IPC to `Transport`
 *   - `ipc/renderer` — thin client that consumes whatever preload exposed
 *
 * Phase 1 explicitly omits: WebSocket adapter, retry/backoff, subscription
 * backpressure, structured cancellation. Each is a follow-up ticket.
 */

export { TransportError, toTransportError } from "./errors";
export { LoopbackTransport, createLoopbackTransport } from "./loopback";
export { Router } from "./router";
export type {
  RouterContext,
  RouterHandler,
  SubscriptionHandle,
} from "./router";
export type {
  Subscription,
  SubscriptionObserver,
  Transport,
} from "./transport";
