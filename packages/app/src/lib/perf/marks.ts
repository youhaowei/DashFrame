import { usePerfStore } from "./perfStore";
import { type PerfStage } from "./stages";

/**
 * Thin wrapper over the Web Performance API (`performance.mark` / `measure`)
 * that also feeds the in-memory perf store the dev HUD reads from.
 *
 * Design notes:
 * - SSR / non-browser safe: every call no-ops when `performance` is absent.
 * - Zero-cost when disabled: `record` short-circuits on `enabled === false`, so
 *   in production (HUD off) the marks still create native PerformanceEntries
 *   (cheap, useful for external profilers) but never allocate store samples.
 * - Marks use a stable naming scheme so they're greppable in the Performance
 *   timeline: `dashframe:<stage>:<phase>[:<label>]`.
 */

const hasPerf =
  typeof performance !== "undefined" &&
  typeof performance.mark === "function" &&
  typeof performance.measure === "function";

function markName(stage: PerfStage, phase: "start" | "end", label?: string) {
  return label
    ? `dashframe:${stage}:${phase}:${label}`
    : `dashframe:${stage}:${phase}`;
}

/** Place a start mark for a stage. Pair with {@link perfMeasure}. */
export function perfMark(stage: PerfStage, label?: string): void {
  if (!hasPerf) return;
  try {
    performance.mark(markName(stage, "start", label));
  } catch {
    // Marks are best-effort; never let instrumentation throw into the app.
  }
}

/**
 * Close a stage opened with {@link perfMark}, emitting a `performance.measure`
 * and recording a classified sample. Returns the measured duration in ms (or
 * `undefined` if no matching start mark / no Performance API).
 */
export function perfMeasure(
  stage: PerfStage,
  label?: string,
): number | undefined {
  if (!hasPerf) return undefined;
  const start = markName(stage, "start", label);
  const end = markName(stage, "end", label);
  const suffix = label ? `:${label}` : "";
  const measureName = `dashframe:${stage}${suffix}`;
  try {
    performance.mark(end);
    const measure = performance.measure(measureName, start, end);
    const durationMs = measure?.duration ?? 0;
    usePerfStore.getState().record({
      stage,
      label,
      durationMs,
      at: performance.now(),
    });
    // Keep the global PerformanceEntry buffer from growing unbounded across a
    // long session — clear both the marks and the measure we just created.
    // (Render instrumentation runs even when the HUD is disabled, so this must
    // happen regardless of whether a sample was recorded.)
    performance.clearMarks(start);
    performance.clearMarks(end);
    performance.clearMeasures(measureName);
    return durationMs;
  } catch {
    return undefined;
  }
}

/**
 * Measure a synchronous block. Records one sample for the stage.
 *
 * @example
 * withPerf(PerfStage.CommandApply, () => applyCommand(cmd), insightId);
 */
export function withPerf<T>(stage: PerfStage, fn: () => T, label?: string): T {
  perfMark(stage, label);
  try {
    return fn();
  } finally {
    perfMeasure(stage, label);
  }
}

/** Async variant of {@link withPerf}. */
export async function withPerfAsync<T>(
  stage: PerfStage,
  fn: () => Promise<T>,
  label?: string,
): Promise<T> {
  perfMark(stage, label);
  try {
    return await fn();
  } finally {
    perfMeasure(stage, label);
  }
}
