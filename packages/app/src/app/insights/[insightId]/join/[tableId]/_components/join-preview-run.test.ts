/**
 * Contract tests for the Join configuration async-lifecycle helpers.
 *
 * These import and exercise the ACTUAL production code (createLatestRunGuard,
 * runJoinSubmit) — not re-implementations — so a regression in the guard or the
 * submit-recovery flow fails here.
 *
 * Contracts locked:
 *
 * Stale-run guard (createLatestRunGuard):
 *   - Only the latest begun run may write shared state (isCurrent gates it).
 *   - A completed active run settles the spinner; a stale run's settle is a no-op.
 *   - Abandoning a run with NO successor clears the spinner — the stuck-spinner
 *     bug: user clears a column selector while a preview is computing.
 *
 * Submit recovery (runJoinSubmit):
 *   - A rejected mutation restores the button, surfaces an error, and does NOT
 *     run onSuccess (no navigation).
 *   - A resolved mutation runs onSuccess and restores the button with no error.
 */

import { describe, expect, it, vi } from "vitest";
import { createLatestRunGuard, runJoinSubmit } from "./join-preview-run";

// ---------------------------------------------------------------------------
// createLatestRunGuard — stale-run guard + spinner lifecycle
// ---------------------------------------------------------------------------

describe("createLatestRunGuard", () => {
  it("sets the loading flag when a run begins", () => {
    const setLoading = vi.fn();
    const guard = createLatestRunGuard(setLoading);

    guard.begin();

    expect(setLoading).toHaveBeenCalledWith(true);
  });

  it("marks only the latest begun run as current", () => {
    const guard = createLatestRunGuard(vi.fn());

    const first = guard.begin();
    expect(first.isCurrent()).toBe(true);

    const second = guard.begin();
    // The newer run supersedes the first.
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it("clears loading when the active run settles", () => {
    const setLoading = vi.fn();
    const guard = createLatestRunGuard(setLoading);

    const run = guard.begin();
    setLoading.mockClear();

    run.settle();

    expect(setLoading).toHaveBeenCalledWith(false);
    // After settling, the run is no longer current.
    expect(run.isCurrent()).toBe(false);
  });

  it("does NOT clear loading when a stale run settles", () => {
    const setLoading = vi.fn();
    const guard = createLatestRunGuard(setLoading);

    const stale = guard.begin();
    guard.begin(); // newer run supersedes `stale`
    setLoading.mockClear();

    // The stale run finishing must not turn off the spinner the newer run owns.
    stale.settle();

    expect(setLoading).not.toHaveBeenCalled();
  });

  it("clears the spinner when a run is abandoned with no successor (stuck-spinner regression)", () => {
    // Reproduces the bug: a preview run is in flight, then the user clears a
    // column selector. The effect cleanup abandons the run and no replacement
    // run begins. The spinner must clear, not stick forever.
    const setLoading = vi.fn();
    const guard = createLatestRunGuard(setLoading);

    const run = guard.begin(); // spinner on
    setLoading.mockClear();

    // Effect cleanup with no successor begin().
    guard.abandon();

    // Spinner cleared...
    expect(setLoading).toHaveBeenCalledWith(false);
    // ...and the in-flight run is no longer current, so its later state writes
    // are gated out.
    expect(run.isCurrent()).toBe(false);
  });

  it("keeps the spinner on when an abandoned run is immediately replaced by a successor", () => {
    // Mirrors React's cleanup-then-effect ordering: abandon() clears the
    // spinner, but a successor begin() runs synchronously and re-sets it. The
    // net observable state is "loading", and the stale run cannot write.
    const setLoading = vi.fn();
    const guard = createLatestRunGuard(setLoading);

    const stale = guard.begin();
    guard.abandon(); // cleanup of the previous effect run
    const fresh = guard.begin(); // successor effect run

    // Final call to setLoading is `true` (the successor turned it back on).
    expect(setLoading).toHaveBeenLastCalledWith(true);
    expect(stale.isCurrent()).toBe(false);
    expect(fresh.isCurrent()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runJoinSubmit — async error recovery for persisting the join config
// ---------------------------------------------------------------------------

describe("runJoinSubmit", () => {
  it("restores the button and surfaces an error when persist rejects", async () => {
    const setSubmitting = vi.fn();
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await runJoinSubmit({
      persist: () => Promise.reject(new Error("Dexie write failed")),
      onSuccess,
      setError,
      setSubmitting,
    });

    // Button toggled on then back off (not stuck loading).
    expect(setSubmitting).toHaveBeenNthCalledWith(1, true);
    expect(setSubmitting).toHaveBeenLastCalledWith(false);
    // Error surfaced to the user.
    expect(setError).toHaveBeenCalledWith(
      "Failed to save join: Dexie write failed",
    );
    // No navigation on failure.
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("uses a generic message when a non-Error value is thrown", async () => {
    const setError = vi.fn();

    await runJoinSubmit({
      persist: () => Promise.reject("boom"),
      onSuccess: vi.fn(),
      setError,
      setSubmitting: vi.fn(),
    });

    expect(setError).toHaveBeenCalledWith("Failed to save join: Unknown error");
  });

  it("runs onSuccess and restores the button when persist resolves", async () => {
    const setSubmitting = vi.fn();
    const setError = vi.fn();
    const onSuccess = vi.fn();

    await runJoinSubmit({
      persist: () => Promise.resolve(),
      onSuccess,
      setError,
      setSubmitting,
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(setSubmitting).toHaveBeenNthCalledWith(1, true);
    expect(setSubmitting).toHaveBeenLastCalledWith(false);
    // No error on the happy path.
    expect(setError).not.toHaveBeenCalled();
  });

  it("does NOT present a save-failed error or invite retry when onSuccess fails after a successful persist", async () => {
    // The data-integrity contract: persist committed, so a post-save failure
    // (e.g. navigation throwing) must NOT be reported as "Failed to save…".
    // Otherwise the user retries and writes a duplicate join config.
    const persist = vi.fn(() => Promise.resolve());
    const setError = vi.fn();
    const setSubmitting = vi.fn();
    // Silence the expected post-save console.error.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await runJoinSubmit({
      persist,
      onSuccess: () => {
        throw new Error("navigate blew up");
      },
      setError,
      setSubmitting,
    });

    // The write happened exactly once — no retry.
    expect(persist).toHaveBeenCalledTimes(1);
    // No retry-inviting "Failed to save join" error surfaced to the user.
    expect(setError).not.toHaveBeenCalled();
    // Button restored, not stuck loading.
    expect(setSubmitting).toHaveBeenLastCalledWith(false);

    consoleError.mockRestore();
  });

  it("calls persist exactly once when it fails (no implicit retry)", async () => {
    // Guards the persist-failure branch: a single attempt, error surfaced.
    const persist = vi.fn(() => Promise.reject(new Error("write failed")));
    const onSuccess = vi.fn();
    const setError = vi.fn();

    await runJoinSubmit({
      persist,
      onSuccess,
      setError,
      setSubmitting: vi.fn(),
    });

    expect(persist).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith("Failed to save join: write failed");
  });
});
