import { useEffect } from "react";

import { perfMark, perfMeasure } from "./marks";
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
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        perfMeasure(span);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
    // Runs every render so each commit produces one paired span.
  });
}
