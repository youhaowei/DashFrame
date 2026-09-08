import type { WorkspaceQueryEngine } from "@dashframe/engine-server/query-sandbox";
import type { HostDataPlaneRuntime } from "./context";

/** A request may discard its result, but cannot terminate the shared workspace engine. */
export function createHostedQueryRuntime(
  engine: Pick<
    WorkspaceQueryEngine,
    "queryArrow" | "registerArrowTable" | "unregisterTable"
  >,
  signal: AbortSignal,
): HostDataPlaneRuntime {
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    // Keep the workspace lease until accepted work settles. The engine's own
    // operation timeout bounds it; forwarding this signal would kill siblings.
    const result = await operation();
    signal.throwIfAborted();
    return result;
  };
  return {
    queryArrow: (sql, params) => run(() => engine.queryArrow(sql, params)),
    registerArrowTable: (name, bytes) =>
      run(() => engine.registerArrowTable(name, bytes)),
    // Cleanup must remain available after the request result is discarded.
    unregisterTable: (name) => engine.unregisterTable(name),
  };
}
