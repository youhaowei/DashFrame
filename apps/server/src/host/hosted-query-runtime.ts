import type { QueryEngine } from "@dashframe/engine";
import type { HostDataPlaneRuntime } from "./context";

/**
 * The workspace engine as one hosted request sees it.
 *
 * Two things are deliberately not passed through:
 *
 * 1. **Caller abort signals.** Accepted workspace work settles independently of
 *    any one HTTP waiter. The pool discards an aborted caller's response;
 *    forwarding that abort to this shared engine would poison healthy coalesced
 *    sibling requests. A request may discard its result — it cannot cancel
 *    work the engine has already accepted, whether a query or a registration.
 * 2. **Lifecycle.** `initialize()` and `dispose()` belong to the workspace pool
 *    that created the engine and hands it to every request. A request handler
 *    that called them would start or terminate an engine serving other
 *    requests, so they reject instead of delegating.
 */
export function createHostedQueryRuntime(
  engine: QueryEngine,
): HostDataPlaneRuntime {
  return {
    coalescingIdentity: engine,
    initialize: () => Promise.reject(new Error("ENGINE_LIFECYCLE_NOT_OWNED")),
    dispose: () => Promise.reject(new Error("ENGINE_LIFECYCLE_NOT_OWNED")),
    isReady: () => engine.isReady(),
    queryArrow: (sql, params) => engine.queryArrow(sql, params),
    queryArrowBatches: (sql, params) => engine.queryArrowBatches(sql, params),
    registerArrowTable: (name, bytes) => engine.registerArrowTable(name, bytes),
    registerArrowStream: (name, chunks) =>
      engine.registerArrowStream(name, chunks),
    registerArrowBatches: (name, batches) =>
      engine.registerArrowBatches(name, batches),
    unregisterTable: (name) => engine.unregisterTable(name),
    hasTable: (name) => engine.hasTable(name),
    getTableNames: () => engine.getTableNames(),
  };
}
