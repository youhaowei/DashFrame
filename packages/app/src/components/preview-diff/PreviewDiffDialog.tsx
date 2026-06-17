/**
 * PreviewDiffDialog — the preview-open surface.
 *
 * Wraps PreviewDiffRenderer in a dialog that:
 *   1. Accepts a PreviewDiff (metadata-only from the server).
 *   2. Fills compute slots lazily via usePreviewComputeFill (client-side DuckDB).
 *   3. Renders immediately with metadata; compute fills progressively per node.
 *
 * SPLIT-TIER: this component owns the compute-fill boundary. It takes a
 * `PreviewDiff` with `compute: undefined` on all direct nodes and hands the
 * filled diff to `PreviewDiffRenderer` as compute resolves. No server round-trip
 * for row data — all compute is local DuckDB.
 */

import type { PreviewDiff } from "@dashframe/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@wystack/ui";

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
}: PreviewDiffDialogProps) {
  // Fill compute slots lazily — runs entirely client-side, no server RPC.
  // Gate on `open`: a closed (hidden) dialog must not kick DuckDB compute work.
  // Passing null when closed also flips the hook's effect-cleanup cancellation,
  // freeing the single DuckDB-WASM worker.
  const { diff: filledDiff } = usePreviewComputeFill(open ? diff : null);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {filledDiff ? (
          <PreviewDiffRenderer diff={filledDiff} className="pb-2" />
        ) : (
          <p className="text-sm text-neutral-fg/50">No changes to preview.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
