import type { QueryEngine } from "@dashframe/engine";

/**
 * A `QueryEngine` whose every operation fails loudly, for tests that care about
 * one or two of them. Reaching an unstubbed method is a test bug, and this says
 * so rather than letting the call quietly succeed with a default.
 *
 * `unregisterTable` is the one exception: cleanup paths call it on failure
 * routes that are not the subject of the test they run in.
 */
export function stubQueryEngine(
  overrides: Partial<QueryEngine> = {},
): QueryEngine {
  const unexpected = (method: string) => () => {
    throw new Error(`unexpected QueryEngine.${method}`);
  };
  return {
    initialize: unexpected("initialize"),
    dispose: unexpected("dispose"),
    isReady: () => true,
    queryArrow: unexpected("queryArrow"),
    queryArrowBatches: unexpected("queryArrowBatches"),
    registerArrowTable: unexpected("registerArrowTable"),
    registerArrowStream: unexpected("registerArrowStream"),
    unregisterTable: async () => {},
    hasTable: () => false,
    getTableNames: () => [],
    ...overrides,
  };
}
