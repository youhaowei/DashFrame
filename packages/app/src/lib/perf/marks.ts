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
 * - Overlap-safe: each {@link perfMark} mints a *unique* mark name (instance
 *   counter), and {@link perfMeasure} closes that exact span. Two measurements
 *   that reuse the same stage/label before the first finishes (e.g. rapid
 *   keystrokes firing overlapping async command applies) therefore don't collide
 *   on a shared mark name — no under-measurement, no dropped samples.
 * - Marks use a stable, greppable scheme: `dashframe:<stage>[:<label>]:<phase>#<id>`.
 */

const hasPerf =
  typeof performance !== "undefined" &&
  typeof performance.mark === "function" &&
  typeof performance.measure === "function";

let nextSpanId = 0;

/** Opaque handle returned by {@link perfMark}, passed back to {@link perfMeasure}. */
export interface PerfSpan {
  stage: PerfStage;
  label?: string;
  startMark: string;
  endMark: string;
  measureName: string;
}

function base(stage: PerfStage, label?: string): string {
  return label ? `dashframe:${stage}:${label}` : `dashframe:${stage}`;
}

/**
 * Open a span for a stage. Returns a {@link PerfSpan} handle to pass to
 * {@link perfMeasure}, or `undefined` if the Performance API is unavailable.
 */
export function perfMark(
  stage: PerfStage,
  label?: string,
): PerfSpan | undefined {
  if (!hasPerf) return undefined;
  const id = nextSpanId++;
  const root = base(stage, label);
  const span: PerfSpan = {
    stage,
    label,
    startMark: `${root}:start#${id}`,
    endMark: `${root}:end#${id}`,
    measureName: `${root}#${id}`,
  };
  try {
    performance.mark(span.startMark);
  } catch {
    // Marks are best-effort; never let instrumentation throw into the app.
  }
  return span;
}

/**
 * Close a span opened with {@link perfMark}, emitting a `performance.measure`
 * and recording a classified sample. Returns the measured duration in ms (or
 * `undefined` if no span / no Performance API).
 */
export function perfMeasure(span: PerfSpan | undefined): number | undefined {
  if (!hasPerf || !span) return undefined;
  const { stage, label, startMark, endMark, measureName } = span;
  try {
    performance.mark(endMark);
    const measure = performance.measure(measureName, startMark, endMark);
    const durationMs = measure?.duration ?? 0;
    usePerfStore.getState().record({
      stage,
      label,
      durationMs,
      at: performance.now(),
    });
    // Keep the global PerformanceEntry buffer from growing unbounded across a
    // long session — clear this span's marks and measure. Because the names are
    // unique per span, this never removes a still-active overlapping span's
    // marks. (Render instrumentation runs even when the HUD is disabled, so this
    // must happen regardless of whether a sample was recorded.)
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
    performance.clearMeasures(measureName);
    return durationMs;
  } catch {
    return undefined;
  }
}

/**
 * Discard an opened span without measuring it — clears its start mark so it
 * doesn't leak into the PerformanceEntries buffer. Call this when a span is
 * abandoned (e.g. a render commits and opens a span, but the component
 * re-renders or unmounts before the paint callback closes it).
 */
export function perfCancel(span: PerfSpan | undefined): void {
  if (!hasPerf || !span) return;
  try {
    performance.clearMarks(span.startMark);
  } catch {
    // Best-effort cleanup.
  }
}

/**
 * Measure a synchronous block. Records one sample for the stage.
 *
 * @example
 * withPerf(PerfStage.CommandApply, () => applyCommand(cmd), insightId);
 */
export function withPerf<T>(stage: PerfStage, fn: () => T, label?: string): T {
  const span = perfMark(stage, label);
  try {
    return fn();
  } finally {
    perfMeasure(span);
  }
}

/** Async variant of {@link withPerf}. */
export async function withPerfAsync<T>(
  stage: PerfStage,
  fn: () => Promise<T>,
  label?: string,
): Promise<T> {
  const span = perfMark(stage, label);
  try {
    return await fn();
  } finally {
    perfMeasure(span);
  }
}
