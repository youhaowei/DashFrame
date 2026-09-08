import type { WorkspaceQueryEngine } from "@dashframe/engine-server/query-sandbox";
import type { HostDataPlaneRuntime } from "./context";

/** A request may discard its result, but cannot terminate the shared workspace engine. */
export function createHostedQueryRuntime(
  engine: Pick<
    WorkspaceQueryEngine,
    "queryArrow" | "registerArrowTable" | "unregisterTable"
  >,
): HostDataPlaneRuntime {
  return {
    coalescingIdentity: engine,
    // Accepted workspace work settles independently of any one HTTP waiter.
    // The pool discards an aborted caller's response; forwarding that abort to
    // this shared engine would poison healthy coalesced sibling requests.
    queryArrow: (sql, params) => engine.queryArrow(sql, params),
    registerArrowTable: (name, bytes) => engine.registerArrowTable(name, bytes),
    unregisterTable: (name) => engine.unregisterTable(name),
  };
}
