/**
 * DraftReviewPanel — shown in the assistant sidebar when a draft is pending
 * review (pendingDraftId is set in AssistantStore).
 *
 * Flow:
 *   1. The pi-agent sets `pendingDraftId` in AssistantStore after building a
 *      draft, which surfaces this panel.
 *   2. The panel loads the draft's command log via the `getDraftLog` RPC, then
 *      calls `previewBatch` to produce a PreviewDiff (server metadata only).
 *   3. The user opens the diff in PreviewDiffDialog, which fills compute slots
 *      client-side via local DuckDB.
 *   4. The user chooses Publish (→ `publishDraft` RPC, WS invalidation fires
 *      automatically) or Discard (→ `discardDraft` RPC).
 *   5. Either action clears `pendingDraftId` from the store.
 *
 * The dialog is opened by this panel (not the other way around): this component
 * holds the loading / diff state and the publish/discard handlers. PreviewDiffDialog
 * is read-only until both callbacks are wired — that is the case here.
 */
import { useCallback, useState } from "react";

import type { PreviewDiff } from "@dashframe/types";
import { discardDraft, getDraftLog, previewBatch, publishDraft } from "@dashframe/core";
import { Button, cn } from "@wystack/ui";
import { FileIcon, SparklesIcon } from "@wystack/ui-icons";
import { toast } from "sonner";

import { PreviewDiffDialog } from "@/components/preview-diff/PreviewDiffDialog";
import { useAssistantStore } from "@/lib/stores/assistant-store";

/**
 * Panel body rendered in the assistant sidebar when there is a draft to review.
 */
export function DraftReviewPanel({ draftId }: { draftId: string }) {
  const setPendingDraft = useAssistantStore((s) => s.setPendingDraft);

  // Diff state: null = not yet loaded / dialog not open.
  const [diff, setDiff] = useState<PreviewDiff | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Load the draft log, compute the diff, open the dialog. */
  const handleReview = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const commands = await getDraftLog(draftId);
      if (commands.length === 0) {
        toast.info("The draft has no changes to preview.");
        return;
      }
      const preview = await previewBatch(commands);
      setDiff(preview);
      setDialogOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(`Could not load draft: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  }, [draftId]);

  /** Publish the draft and close the review surface. */
  const handlePublish = useCallback(async () => {
    try {
      await publishDraft(draftId);
      toast.success("Draft published.");
      setDialogOpen(false);
      setPendingDraft(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Publish failed: ${msg}`);
      // Re-throw so PreviewDiffDialog shows the button as no longer spinning.
      throw err;
    }
  }, [draftId, setPendingDraft]);

  /**
   * Discard the draft. Re-throws on failure so PreviewDiffDialog can reset its
   * loading state. Used as the dialog's `onDiscard` prop.
   */
  const handleDiscard = useCallback(async () => {
    try {
      await discardDraft(draftId);
      toast.info("Draft discarded.");
      setDialogOpen(false);
      setDiff(null);
      setPendingDraft(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Discard failed: ${msg}`);
      throw err;
    }
  }, [draftId, setPendingDraft]);

  /**
   * Quick-discard from the panel card (no dialog, no re-throw). Errors surface
   * as toasts; promise is safe to fire-and-forget.
   */
  const handleQuickDiscard = useCallback(async () => {
    if (isLoading) return;
    try {
      await discardDraft(draftId);
      toast.info("Draft discarded.");
      setPendingDraft(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Discard failed: ${msg}`);
    }
  }, [draftId, isLoading, setPendingDraft]);

  const handleDialogClose = useCallback(() => {
    setDialogOpen(false);
  }, []);

  return (
    <>
      <div className="flex h-full flex-col">
        {/* Draft ready card */}
        <div className="flex-1 px-4 py-5">
          <div
            className={cn(
              "rounded-xl border border-palette-primary/20 bg-palette-primary/5 p-4",
            )}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-palette-primary/10 text-palette-primary">
                <FileIcon className="size-4" />
              </span>
              <span className="text-xs font-semibold text-neutral-fg">
                Draft ready for review
              </span>
            </div>
            <p className="mb-4 text-[11px] leading-relaxed text-neutral-fg-subtle">
              The assistant has proposed changes. Review the diff, then publish
              to apply or discard to start over.
            </p>

            {loadError && (
              <p className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-600 dark:text-red-400">
                {loadError}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Button
                label={isLoading ? "Loading diff…" : "Review changes"}
                onClick={handleReview}
                disabled={isLoading}
                className="w-full"
                size="sm"
              />
              <Button
                label="Discard draft"
                variant="ghost"
                onClick={() => void handleQuickDiscard()}
                disabled={isLoading}
                className="w-full text-neutral-fg-subtle hover:text-neutral-fg"
                size="sm"
              />
            </div>
          </div>
        </div>

        {/* Footer hint */}
        <div className="border-t border-neutral-border/60 px-4 py-3">
          <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-neutral-fg-subtle">
            <SparklesIcon className="size-3 shrink-0" />
            Review the proposed changes before publishing to your project.
          </p>
        </div>
      </div>

      {/* The diff dialog — opened by handleReview, dismissed by handleDialogClose */}
      <PreviewDiffDialog
        diff={diff}
        open={dialogOpen}
        onClose={handleDialogClose}
        title="Review draft changes"
        onPublish={handlePublish}
        onDiscard={handleDiscard}
      />
    </>
  );
}
