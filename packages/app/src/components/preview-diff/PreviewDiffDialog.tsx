/**
 * PreviewDiffDialog — the preview-open surface.
 *
 * Wraps PreviewDiffRenderer in a dialog that:
 *   1. Accepts a PreviewDiff (metadata-only from the server).
 *   2. Fills compute slots lazily via usePreviewComputeFill (client-side DuckDB).
 *   3. Renders immediately with metadata; compute fills progressively per node.
 *   4. Optionally shows Publish / Discard actions when callbacks are supplied.
 *
 * SPLIT-TIER: this component owns the compute-fill boundary. It takes a
 * `PreviewDiff` with `compute: undefined` on all direct nodes and hands the
 * filled diff to `PreviewDiffRenderer` as compute resolves. No server round-trip
 * for row data — all compute is local DuckDB.
 *
 * ACTION CALLBACKS: `onPublish` and `onDiscard` are optional. When absent the
 * dialog is read-only (preview only). When present a footer renders with
 * "Discard" (outline variant) and "Publish" (primary variant) buttons. Both
 * buttons are disabled while either action is in-flight; the spinner resets via
 * `finally` regardless of outcome. The callback owns user-facing error surfacing
 * (toast); errors thrown by a callback are swallowed here to prevent unhandled
 * promise rejections.
 */

import { useState } from "react";

import type { PreviewDiff } from "@dashframe/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@wystack/ui";

import { PreviewDiffRenderer } from "./PreviewDiffRenderer";
import { usePreviewComputeFill } from "./usePreviewComputeFill";

interface PreviewDiffDialogProps {
  /** The diff received from the server — compute slots are always `undefined`. */
  diff: PreviewDiff | null;
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the dialog requests to close. */
  onClose: () => void;
  /** Optional title override. Defaults to "Preview changes". */
  title?: string;
  /**
   * When provided, a "Publish" button appears in the footer. The dialog
   * disables both actions while the callback is in-flight. The callback is
   * responsible for closing the dialog (call `onClose`) after completion.
   */
  onPublish?: () => Promise<void> | void;
  /**
   * When provided, a "Discard" button appears in the footer alongside Publish.
   * Same in-flight semantics as `onPublish`.
   */
  onDiscard?: () => Promise<void> | void;
}

/**
 * Preview-open surface: shows the diff immediately with metadata; fills compute
 * (rowCounts + head rows) lazily via local DuckDB as each node resolves.
 */
export function PreviewDiffDialog({
  diff,
  open,
  onClose,
  title = "Preview changes",
  onPublish,
  onDiscard,
}: PreviewDiffDialogProps) {
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const isBusy = isPublishing || isDiscarding;

  // Fill compute slots lazily — runs entirely client-side, no server RPC.
  // Gate on `open`: a closed (hidden) dialog must not kick DuckDB compute work.
  // Passing null when closed also flips the hook's effect-cleanup cancellation,
  // freeing the single DuckDB-WASM worker.
  const { diff: filledDiff } = usePreviewComputeFill(open ? diff : null);

  const hasActions = onPublish !== undefined || onDiscard !== undefined;

  async function handlePublish() {
    if (!onPublish || isBusy) return;
    setIsPublishing(true);
    try {
      await onPublish();
    } catch {
      // The callback owns user-facing error surfacing (toast). Swallow here so
      // the dialog doesn't emit an unhandled rejection — `finally` resets the
      // spinner regardless.
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleDiscard() {
    if (!onDiscard || isBusy) return;
    setIsDiscarding(true);
    try {
      await onDiscard();
    } catch {
      // Same pattern as handlePublish — callback owns the toast, swallow here.
    } finally {
      setIsDiscarding(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isBusy) onClose();
      }}
    >
      {/*
       * Three-row grid (DialogContent base sets display:grid): header (auto) /
       * scroll body (1fr) / footer (auto). Only apply the row template when
       * the footer renders — an empty third track still consumes a gap-4 gap.
       *
       * min-h-0 on the scroll wrapper is required: grid items default to
       * min-height:auto, which prevents shrinking below content height and
       * makes overflow-y-auto a no-op.
       */}
      <DialogContent
        className={
          hasActions
            ? "grid-rows-[auto_1fr_auto] max-h-[80vh] max-w-2xl overflow-hidden"
            : "max-h-[80vh] max-w-2xl overflow-hidden"
        }
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {filledDiff ? (
            <PreviewDiffRenderer diff={filledDiff} className="pb-2" />
          ) : (
            <p className="text-sm text-neutral-fg/50">No changes to preview.</p>
          )}
        </div>
        {hasActions && (
          <DialogFooter>
            {onDiscard && (
              <Button
                label={isDiscarding ? "Discarding…" : "Discard"}
                variant="outline"
                onClick={handleDiscard}
                disabled={isBusy}
              />
            )}
            {onPublish && (
              <Button
                label={isPublishing ? "Publishing…" : "Publish"}
                onClick={handlePublish}
                disabled={isBusy}
              />
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
