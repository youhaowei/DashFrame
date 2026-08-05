/** User-facing copy for preview/draft flows — never surface raw runtime errors. */

export function previewFailureSummary(commandIndex: number): string {
  return `Command ${commandIndex + 1} in this draft could not be previewed. Review or edit the draft, then try again.`;
}

export function previewFailureDetail(): string {
  return "One command in this draft could not be previewed. Discard this draft or go back and fix the failing command before publishing.";
}

/**
 * Copy for the one failure a reviewer can act on: the draft moved underneath
 * them. Every OTHER failure — a permission rejection, a dropped connection, a
 * malformed op — must NOT be reported as drift, or a security denial reads to
 * the user as a harmless race and invites a pointless retry. Callers pair this
 * with `isDriftError` and fall back to `draftLifecycleErrorDescription`.
 */
export const DRAFT_DRIFT_DESCRIPTION =
  "This draft changed while you were reviewing it. Reload to see the current changes.";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

/** True only for the server's log-drift rejections (see `computeLogSignature`). */
export function isDriftError(error: unknown): boolean {
  return /changed since review|content drift|count mismatch/i.test(
    errorMessage(error),
  );
}

export function draftLifecycleErrorDescription(error: unknown): string {
  if (!(error instanceof Error)) return "Please try again.";

  const message = error.message;
  if (message.includes("late-bound operands")) {
    return "This draft still has values that need binding before it can publish.";
  }
  // No drift branch here on purpose: `isDriftError` already matches
  // "changed since review" and every caller checks it FIRST, so a branch for it
  // in the fallback would be unreachable and would drift out of sync with
  // `DRAFT_DRIFT_DESCRIPTION` the moment either string is edited.
  return "Please try again.";
}
