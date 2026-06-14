/**
 * Async-lifecycle helpers for the Join configuration flow.
 *
 * These encapsulate the two reliability contracts that the Join page depends
 * on, as importable pure functions so they can be unit-tested directly (rather
 * than re-implemented in the test file):
 *
 * 1. `createLatestRunGuard` — a stale-run guard for the preview compute effect.
 *    Every time the effect's inputs change, a new run begins; only the latest
 *    run may write shared preview state. Crucially, when a run is abandoned and
 *    no successor begins (e.g. the user clears a column selector so there is
 *    nothing to compute), the loading flag is cleared so the spinner never
 *    sticks.
 *
 * 2. `runJoinSubmit` — the submit flow for persisting the join config. It owns
 *    the try/catch/finally so a rejected mutation always restores the button,
 *    surfaces an error, and does NOT navigate.
 */

/** Handle for a single preview-compute run issued by a {@link LatestRunGuard}. */
export interface RunHandle {
  /**
   * True only while this run is the most recently begun one. Async callbacks
   * must check this after every `await` before writing shared state — a stale
   * run (superseded by a newer begin, or abandoned via cleanup) returns false.
   */
  readonly isCurrent: () => boolean;

  /**
   * Clears the loading flag, but only if this run is still current. Call from
   * the run's `finally` so a completed active run turns the spinner off, while
   * a stale run leaves the newer run's spinner alone.
   */
  readonly settle: () => void;
}

/**
 * Tracks the latest preview-compute run so stale runs can't write shared state,
 * and guarantees the loading flag is cleared when a run ends with no successor.
 *
 * Lifecycle, mirroring a React effect:
 * - `begin()` at the start of each effect run → marks loading true, returns a
 *   handle whose `isCurrent()` is true until a newer `begin()` or `abandon()`.
 * - `abandon()` in the effect cleanup → invalidates the current handle and
 *   clears loading. If the *next* effect run calls `begin()` (synchronously,
 *   as React runs cleanup-then-effect), loading is immediately set true again,
 *   so the transient false is invisible. If no successor begins (the inputs no
 *   longer warrant a compute), loading stays cleared and the spinner resolves.
 *
 * @param setLoading setter for the `isComputingPreview` flag.
 */
export interface LatestRunGuard {
  begin: () => RunHandle;
  abandon: () => void;
}

export function createLatestRunGuard(
  setLoading: (value: boolean) => void,
): LatestRunGuard {
  // Identity of the most recently begun (and not-yet-superseded) run.
  let activeToken: object | null = null;

  return {
    begin(): RunHandle {
      const token = {};
      activeToken = token;
      setLoading(true);
      const isCurrent = () => activeToken === token;
      return {
        isCurrent,
        settle: () => {
          if (isCurrent()) {
            activeToken = null;
            setLoading(false);
          }
        },
      };
    },
    abandon(): void {
      // Invalidate any in-flight run so its state writes become no-ops...
      activeToken = null;
      // ...and clear the spinner. A successor begin() (if one runs) re-sets it
      // synchronously; if none does, this is what unsticks the loading state.
      setLoading(false);
    },
  };
}

/** Inputs for {@link runJoinSubmit}. */
export interface JoinSubmitOptions {
  /** Persists the join config (the awaited mutation that may reject). */
  persist: () => Promise<void>;
  /** Runs only after a successful persist — e.g. navigate away. */
  onSuccess: () => void;
  /** Surfaces a user-facing error string (does not navigate). */
  setError: (message: string) => void;
  /** Toggles the submitting/loading flag for the submit button. */
  setSubmitting: (value: boolean) => void;
}

/**
 * Runs the join-submit flow with full async error recovery.
 *
 * Always restores the button via `finally`, surfaces an error on rejection
 * without navigating, and only calls `onSuccess` when the persist resolves.
 * This is the contract a rejected mutation must satisfy: the button never gets
 * stuck loading, the user sees why it failed, and they stay on the page.
 */
export async function runJoinSubmit({
  persist,
  onSuccess,
  setError,
  setSubmitting,
}: JoinSubmitOptions): Promise<void> {
  setSubmitting(true);
  try {
    await persist();
    onSuccess();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    setError(`Failed to save join: ${message}`);
    // Intentionally do NOT call onSuccess — keep the user on the page to retry.
  } finally {
    setSubmitting(false);
  }
}
