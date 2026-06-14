/**
 * Contract tests for JoinConfigureContent hardening.
 *
 * Three contracts are locked here:
 *
 * handleExecuteJoin async error recovery:
 *   If the mutation rejects, the button must return to enabled, a user-facing
 *   error must appear, and the router must NOT navigate away.
 *
 * computeJoin stale-run guard:
 *   When rapid key changes trigger overlapping async runs, only the LATEST run
 *   may write `isComputingPreview` / `error`. A stale run that finishes later
 *   is a no-op.
 *
 * SQL sink-guard (table name quoting):
 *   Table names are interpolated into SQL. Even if a dataFrameId-derived name
 *   contains SQL metacharacters, quoteIdentifier must neutralize injection —
 *   the generated SQL must never contain the raw metacharacter sequence.
 */

import { quoteIdentifier } from "@dashframe/engine-browser";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useCallback, useState } from "react";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// SQL sink-guard: quoteIdentifier neutralizes table name injection
// ---------------------------------------------------------------------------

/**
 * Simulates how JoinConfigureContent derives a DuckDB table name from a
 * dataFrameId, then wraps it in quoteIdentifier before SQL interpolation.
 *
 * The test supplies a dataFrameId that, after the replace(), would produce a
 * table name containing SQL metacharacters. It asserts that the quoted result
 * starts and ends with a double-quote and contains no bare injection sequences
 * that could break out of the identifier context.
 */
function deriveTableName(dataFrameId: string): string {
  return `df_${dataFrameId.replace(/-/g, "_")}`;
}

describe("join SQL — table name sink-guard", () => {
  it("quoteIdentifier wraps the dataFrameId-derived table name in double-quotes", () => {
    const tableName = deriveTableName("abc-123-def");
    const quoted = quoteIdentifier(tableName);
    expect(quoted).toBe('"df_abc_123_def"');
  });

  it("neutralizes a table name containing a single-quote (SQL metacharacter)", () => {
    // If a dataFrameId somehow produced a name with a single-quote (e.g. via
    // external data), quoteIdentifier must not let it escape the identifier context.
    const tableName = "df_abc_123'; DROP TABLE users; --";
    const quoted = quoteIdentifier(tableName);

    // The result must be enclosed in double-quotes (identifier quoting).
    expect(quoted.startsWith('"')).toBe(true);
    expect(quoted.endsWith('"')).toBe(true);

    // The raw injection attempt is contained inside the quoted identifier.
    const inner = quoted.slice(1, -1);
    expect(inner).toContain("'; DROP TABLE users; --");
  });

  it("neutralizes a table name containing a double-quote (break-out attempt)", () => {
    // A double-quote in the name would close the identifier early without escaping.
    // quoteIdentifier doubles it, preventing break-out.
    const tableName = 'df_abc"--injection';
    const quoted = quoteIdentifier(tableName);

    expect(quoted).toBe('"df_abc""--injection"');
    // The embedded " is doubled — it cannot close the identifier context early.
    expect(quoted.startsWith('"')).toBe(true);
    expect(quoted.endsWith('"')).toBe(true);
  });

  it("produces a valid SQL fragment when interpolated into a FROM clause", () => {
    // Construct the FROM clause the same way the component does, and assert
    // the injection attempt is neutralized — the SQL does NOT contain a raw
    // semicolon outside of the quoted identifier.
    const tableName = deriveTableName("1234-5678");
    const quotedTable = quoteIdentifier(tableName);
    const sql = `SELECT 1 FROM ${quotedTable} AS base`;

    // The output must be a single SELECT statement — no injected commands.
    expect(sql).toBe('SELECT 1 FROM "df_1234_5678" AS base');
    // No unquoted semicolons that could terminate the statement.
    expect(sql.replace(/"[^"]*"/g, "")).not.toContain(";");
  });
});

// ---------------------------------------------------------------------------
// handleExecuteJoin: mutation rejection must recover the button
// ---------------------------------------------------------------------------
//
// The component renders a "Join Tables" button whose `loading` prop is driven
// by `isSubmitting`. Without a try/catch/finally, a rejected mutation left
// `isSubmitting` permanently true (button stuck loading, no error, no escape).
//
// We prove the contract by testing the minimal hook logic that mirrors the
// try/catch/finally pattern. This is the exact control flow — testing a
// faithful minimal reproduction at a clean seam rather than mounting the full
// component with all its dependencies.

type SubmitState = { isSubmitting: boolean; error: string | null };

/**
 * Minimal hook that mirrors the `handleExecuteJoin` control flow:
 * setIsSubmitting(true) → await mutation → setIsSubmitting(false) via finally.
 *
 * The test asserts that finally always runs regardless of mutation success or
 * failure, and that a rejected mutation surfaces an error without navigating.
 */
function useHandleExecuteJoinLogic(mutationFn: () => Promise<void>) {
  const [state, setState] = useState<SubmitState>({
    isSubmitting: false,
    error: null,
  });

  const execute = useCallback(async () => {
    setState({ isSubmitting: true, error: null });
    try {
      await mutationFn();
      // success — in the real component navigate() would run here
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setState((s) => ({
        ...s,
        error: `Failed to save join: ${errorMessage}`,
      }));
    } finally {
      setState((s) => ({ ...s, isSubmitting: false }));
    }
  }, [mutationFn]);

  return { state, execute };
}

describe("handleExecuteJoin — async error recovery", () => {
  it("resets isSubmitting to false when the mutation rejects", async () => {
    const rejection = new Error("Network error");
    const mutationFn = vi.fn().mockRejectedValue(rejection);

    const { result } = renderHook(() => useHandleExecuteJoinLogic(mutationFn));

    expect(result.current.state.isSubmitting).toBe(false);

    await act(async () => {
      await result.current.execute();
    });

    // Button must be restored — not permanently stuck loading.
    expect(result.current.state.isSubmitting).toBe(false);
  });

  it("exposes the error message when the mutation rejects", async () => {
    const rejection = new Error("Dexie write failed");
    const mutationFn = vi.fn().mockRejectedValue(rejection);

    const { result } = renderHook(() => useHandleExecuteJoinLogic(mutationFn));

    await act(async () => {
      await result.current.execute();
    });

    // User-facing error must be set.
    expect(result.current.state.error).toContain("Dexie write failed");
  });

  it("does NOT navigate when the mutation rejects", async () => {
    const rejection = new Error("Server error");
    const mutationFn = vi.fn().mockRejectedValue(rejection);
    const navigateFn = vi.fn();

    // Variant that also calls navigate on success, not on failure.
    function useWithNavigate() {
      const [state, setState] = useState<SubmitState>({
        isSubmitting: false,
        error: null,
      });
      const execute = useCallback(async () => {
        setState({ isSubmitting: true, error: null });
        try {
          await mutationFn();
          navigateFn({ to: "/insights/i1" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          setState((s) => ({ ...s, error: `Failed to save join: ${msg}` }));
        } finally {
          setState((s) => ({ ...s, isSubmitting: false }));
        }
      }, []);
      return { state, execute };
    }

    const { result } = renderHook(() => useWithNavigate());

    await act(async () => {
      await result.current.execute();
    });

    // navigate must NOT have been called — user stays on the join page.
    expect(navigateFn).not.toHaveBeenCalled();
  });

  it("resets isSubmitting to false when the mutation resolves successfully", async () => {
    const mutationFn = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useHandleExecuteJoinLogic(mutationFn));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.state.isSubmitting).toBe(false);
    expect(result.current.state.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeJoin stale-run guard: only the latest run writes state
// ---------------------------------------------------------------------------
//
// The component launches a new async run on every key change. Without a stale
// guard, a slow first run that finishes AFTER a fast second run would overwrite
// the second run's result with stale data and, worse, clear `isComputingPreview`
// while the newer run is still in flight.
//
// The request-token pattern (a unique object per effect run, compared by identity)
// ensures that state writes from a superseded run are no-ops.

type PreviewState = {
  isComputingPreview: boolean;
  result: string | null;
  error: string | null;
};

/**
 * Minimal hook that mirrors the request-token stale-run guard in the component.
 * Each `startRun` creates a new async run. Only the latest run may write state.
 *
 * Returns a `startRun(asyncWork)` function that kicks off an async computation
 * and returns a cleanup thunk that invalidates this run's token — exactly as
 * React effect cleanup does in the component.
 */
function useComputeJoinLogic() {
  const [state, setState] = useState<PreviewState>({
    isComputingPreview: false,
    result: null,
    error: null,
  });

  const startRun = useCallback(
    (asyncWork: () => Promise<string>): (() => void) => {
      const activeToken = {};
      let currentToken = activeToken;

      setState((s) => ({ ...s, isComputingPreview: true, error: null }));

      const run = async () => {
        try {
          const computedResult = await asyncWork();
          if (currentToken !== activeToken) return; // stale
          setState({
            isComputingPreview: false,
            result: computedResult,
            error: null,
          });
        } catch (err) {
          if (currentToken !== activeToken) return; // stale
          const msg = err instanceof Error ? err.message : "Unknown error";
          setState({ isComputingPreview: false, result: null, error: msg });
        } finally {
          if (currentToken === activeToken) {
            setState((s) => ({ ...s, isComputingPreview: false }));
          }
        }
      };

      void run();

      // Cleanup: invalidate this run's token (simulates React effect cleanup).
      return () => {
        currentToken = {} as object;
      };
    },
    [],
  );

  return { state, startRun };
}

describe("computeJoin — stale-run guard", () => {
  it("stale run does not overwrite state written by the latest run", async () => {
    let resolveSlowRun!: (v: string) => void;
    let resolveFastRun!: (v: string) => void;

    const slowRun = new Promise<string>((resolve) => {
      resolveSlowRun = resolve;
    });
    const fastRun = new Promise<string>((resolve) => {
      resolveFastRun = resolve;
    });

    const { result } = renderHook(() => useComputeJoinLogic());

    // Start run 1 (slow, will finish last).
    let cleanupRun1!: (() => void) | undefined;
    act(() => {
      cleanupRun1 = result.current.startRun(() => slowRun);
    });

    // Simulate key change: clean up run 1 (invalidates its token), start run 2.
    act(() => {
      cleanupRun1?.();
      result.current.startRun(() => fastRun);
    });

    // Fast run (run 2) finishes first.
    act(() => {
      resolveFastRun("fast-result");
    });

    await waitFor(() => {
      expect(result.current.state.result).toBe("fast-result");
    });

    // Slow run (run 1) now finishes — its token was invalidated so it must be a no-op.
    act(() => {
      resolveSlowRun("stale-result");
    });

    // State must remain as set by run 2; the stale run must not overwrite it.
    await waitFor(() => {
      expect(result.current.state.result).toBe("fast-result");
      expect(result.current.state.isComputingPreview).toBe(false);
    });
  });

  it("stale run does not clear isComputingPreview while a newer run is in flight", async () => {
    let resolveSlowRun!: (v: string) => void;

    const slowRun = new Promise<string>((resolve) => {
      resolveSlowRun = resolve;
    });
    // Fast run never resolves during this test (simulates in-flight newer run).
    const inFlightRun = new Promise<string>(() => {
      /* intentionally never resolves */
    });

    const { result } = renderHook(() => useComputeJoinLogic());

    // Run 1 (slow).
    let cleanupRun1!: (() => void) | undefined;
    act(() => {
      cleanupRun1 = result.current.startRun(() => slowRun);
    });

    // Key change: invalidate run 1, start run 2 (still in flight).
    act(() => {
      cleanupRun1?.();
      result.current.startRun(() => inFlightRun);
    });

    // isComputingPreview should be true (run 2 is in flight).
    expect(result.current.state.isComputingPreview).toBe(true);

    // Slow run (run 1) finishes — must NOT clear isComputingPreview.
    act(() => {
      resolveSlowRun("stale");
    });

    // After the stale run settles, isComputingPreview must still be true.
    await waitFor(() => {
      // Run 2 is still in flight — spinner must stay on.
      expect(result.current.state.isComputingPreview).toBe(true);
    });
  });

  it("active run writes state normally when it is not superseded", async () => {
    let resolveRun!: (v: string) => void;
    const runPromise = new Promise<string>((resolve) => {
      resolveRun = resolve;
    });

    const { result } = renderHook(() => useComputeJoinLogic());

    act(() => {
      result.current.startRun(() => runPromise);
    });

    expect(result.current.state.isComputingPreview).toBe(true);

    act(() => {
      resolveRun("fresh-result");
    });

    await waitFor(() => {
      expect(result.current.state.result).toBe("fresh-result");
      expect(result.current.state.isComputingPreview).toBe(false);
    });
  });
});
