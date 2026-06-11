import { useEffect } from "react";

import { perfCancel, perfMark, perfMeasure } from "./marks";
import { PerfStage } from "./stages";

/**
 * Instruments a render boundary: opens a span when the render commits and closes
 * it after the browser has painted (via a double rAF), so the sample reflects
 * commit-to-pixels rather than just React's reconcile time.
 *
 * Drop this at the top of a hero surface (e.g. the artifact center) to feed the
 * dev HUD a per-route render duration.
 *
 * The span is opened and closed entirely within the effect (no deps → every
 * render), so each open is paired 1:1 with exactly one close, and overlapping
 * renders get independent, uniquely-named spans — no mark collisions.
 *
 * @param label Stable label for the boundary (route id, artifact id, …).
 */
export function useRenderPerf(label: string): void {
  useEffect(() => {
    // Open at commit; the unique-span marks helper keeps overlapping commits
    // from colliding on a shared mark name.
    const span = perfMark(PerfStage.Render, label);

    // `requestAnimationFrame` is absent in some non-visual runtimes (jsdom
    // shims, SSR). `AppLayout`/`AssistantRegion` call this hook unconditionally
    // and are exercised under jsdom, so fall back to a timer rather than
    // throwing from the effect.
    const schedule: (cb: () => void) => number =
      typeof requestAnimationFrame === "function"
        ? (cb) => requestAnimationFrame(() => cb())
        : (cb) => setTimeout(cb, 0) as unknown as number;
    const cancel: (handle: number) => void =
      typeof cancelAnimationFrame === "function"
        ? cancelAnimationFrame
        : (handle) => clearTimeout(handle);

    let measured = false;
    let raf2 = 0;
    const raf1 = schedule(() => {
      raf2 = schedule(() => {
        perfMeasure(span);
        measured = true;
      });
    });
    return () => {
      cancel(raf1);
      if (raf2) cancel(raf2);
      // If we re-rendered/unmounted before the paint callback measured the span,
      // discard its start mark so it doesn't leak into the entries buffer.
      if (!measured) perfCancel(span);
    };
    // Runs every render so each commit produces one paired span.
  });
}
