/**
 * Performance instrumentation — local-only, no remote telemetry.
 *
 * `performance.mark`/`measure` pairs at command-dispatch and render boundaries
 * in the shared renderer, collected into an in-memory store and surfaced in a
 * dev-only HUD. Stage timings are classified against latency budgets recorded
 * in the v0.3 UI spec; budgets are measurement anchors, never hard failures.
 */
export { perfMark, perfMeasure, withPerf, withPerfAsync } from "./marks";
export { PerfHud } from "./PerfHud";
export { usePerfStore, type PerfSample } from "./perfStore";
export {
  PerfStage,
  STAGE_BUDGET_MS,
  UNOWNED_STAGES,
  classifyDuration,
  type BudgetVerdict,
} from "./stages";
export { useRenderPerf } from "./useRenderPerf";
