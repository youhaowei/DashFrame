import { create } from "zustand";

import { type BudgetVerdict, type PerfStage, classifyDuration } from "./stages";

/** A single completed measurement, classified against its stage budget. */
export interface PerfSample {
  id: number;
  stage: PerfStage;
  /** Optional sub-label, e.g. the route or artifact the measure belongs to. */
  label?: string;
  durationMs: number;
  verdict: BudgetVerdict;
  /** `performance.now()` timestamp at completion. */
  at: number;
}

const MAX_SAMPLES = 200;

interface PerfState {
  /** Whether instrumentation is actively recording. */
  enabled: boolean;
  /** Ring buffer of recent samples, newest last. */
  samples: PerfSample[];
}

interface PerfActions {
  setEnabled: (enabled: boolean) => void;
  record: (sample: Omit<PerfSample, "id" | "verdict">) => void;
  clear: () => void;
}

let nextId = 0;

/**
 * In-memory collector for performance samples. Intentionally NOT persisted and
 * NOT sent anywhere: instrumentation is local-only with no remote telemetry
 * (privacy posture + public repo). Samples live for the session and feed the
 * dev HUD; they evaporate on reload.
 *
 * `enabled` defaults to dev only — in production the recorder is a no-op so the
 * mark/measure helpers cost nothing.
 */
export const usePerfStore = create<PerfState & PerfActions>()((set) => ({
  // Optional-chain so importing this package from a non-Vite runtime (a Bun/
  // Node script, a standalone test runner) where `import.meta.env` is undefined
  // doesn't throw at module load.
  enabled: Boolean(import.meta.env?.DEV),
  samples: [],

  setEnabled: (enabled) => set({ enabled }),

  record: (sample) =>
    set((state) => {
      if (!state.enabled) return state;
      const next = [
        ...state.samples,
        {
          ...sample,
          id: nextId++,
          verdict: classifyDuration(sample.stage, sample.durationMs),
        },
      ];
      // Bound the ring buffer so a long session can't grow without limit.
      if (next.length > MAX_SAMPLES) next.splice(0, next.length - MAX_SAMPLES);
      return { samples: next };
    }),

  clear: () => set({ samples: [] }),
}));
