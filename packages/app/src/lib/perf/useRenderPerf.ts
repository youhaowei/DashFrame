import { useEffect } from "react";

import { perfMark, perfMeasure } from "./marks";
import { PerfStage } from "./stages";

/**
 * Instruments a render boundary: marks at the start of a render pass and
 * measures after the browser has committed + painted (via a double rAF), so the
 * sample reflects time-to-pixels rather than just React's reconcile time.
 *
 * Drop this at the top of a hero surface (e.g. the artifact center) to feed the
 * dev HUD a per-route render duration.
 *
 * The mark/measure pair runs on *every* render (the effect has no dependency
 * array) so each synchronous start mark is closed by exactly one measure —
 * keeping marks paired 1:1 with render instances. (`performance.measure` resolves
 * a start mark by name, so leaving same-label marks unpaired across re-renders
 * would skew later measurements.)
 *
 * @param label Stable label for the boundary (route id, artifact id, …).
 */
export function useRenderPerf(label: string): void {
  // Mark synchronously during render so the start precedes commit.
  perfMark(PerfStage.Render, label);

  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        perfMeasure(PerfStage.Render, label);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
    // Intentionally runs every render: one measure per start mark, so marks stay
    // paired 1:1 with render instances rather than accumulating on same-label
    // re-renders.
  });
}
