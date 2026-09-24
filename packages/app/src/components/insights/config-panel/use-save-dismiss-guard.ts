import { useCallback, useRef, useState } from "react";

/**
 * Keeps a popover editor on screen while its save is in flight.
 *
 * Disabling the Cancel button is not enough: Escape and an outside click both
 * reach the popover shell's `onOpenChange` directly. Dismissing a pending save
 * lets the user open a second editor, and when the first promise settles its
 * completion could otherwise clear state owned by a newly opened editor,
 * discarding that edit.
 *
 * The inner form owns the saving flag, so it reports transitions up through
 * `setPending`; the shell checks `isPending()` before honouring a dismissal.
 * A ref rather than state, because a dismissal can arrive in the same tick as
 * the transition that set it.
 *
 * Candidate for extraction into `@wystack/ui-react` — the insight config
 * popovers share this shell behavior, and nothing here is insight-specific.
 */
export function useSaveDismissGuard(): {
  setPending: (pending: boolean) => void;
  isPending: () => boolean;
} {
  const pendingRef = useRef(false);
  const setPending = useCallback((pending: boolean) => {
    pendingRef.current = pending;
  }, []);
  const isPending = useCallback(() => pendingRef.current, []);
  return { setPending, isPending };
}

/**
 * The saving flag for a popover's inner form, mirrored to the shell's dismiss
 * guard. Drop-in for `useState(false)` at each form's `isSaving`, so the two
 * cannot drift apart.
 */
export function useSavingFlag(
  onPendingChange?: (pending: boolean) => void,
): readonly [boolean, (pending: boolean) => void] {
  const [isSaving, setIsSavingState] = useState(false);
  const setIsSaving = useCallback(
    (pending: boolean) => {
      setIsSavingState(pending);
      onPendingChange?.(pending);
    },
    [onPendingChange],
  );
  return [isSaving, setIsSaving] as const;
}
