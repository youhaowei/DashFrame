/**
 * DraftReviewPanel — shown in the assistant sidebar when a draft is pending
 * review (pendingDraftId is set in AssistantStore).
 *
 * Flow:
 *   1. The pi-agent sets `pendingDraftId` in AssistantStore after building a
 *      draft, which surfaces this panel.
 *   2. The panel loads `draftPublishReview` (redacted command summary + diff +
 *      late-bound metadata) and opens PreviewDiffDialog.
 *   3. The user opens the diff in PreviewDiffDialog, which fills compute slots
 *      client-side via local DuckDB.
 *   4. Publish is blocked when the review RPC reports late-bound operands or a
 *      preview error; the user can open `/drafts/:draftId/publish` to resolve.
 *   5. Otherwise the user chooses Publish (→ `publishDraft` RPC) or Discard.
 */
import { useCallback, useState } from "react";

import {
  discardDraft,
  getDraftPublishReview,
  publishDraft,
} from "@dashframe/core";
import type { PreviewDiff } from "@dashframe/types";
import { useNavigate } from "@tanstack/react-router";
import { Button, cn } from "@wystack/ui";
import { FileIcon, SparklesIcon } from "@wystack/ui-icons";
import { toast } from "sonner";

import { PreviewDiffDialog } from "@/components/preview-diff/PreviewDiffDialog";
import { useAssistantStore } from "@/lib/stores/assistant-store";

/**
 * Panel body rendered in the assistant sidebar when there is a draft to review.
 */
export function DraftReviewPanel({ draftId }: { draftId: string }) {
  const navigate = useNavigate();
  const setPendingDraft = useAssistantStore((s) => s.setPendingDraft);

  const [diff, setDiff] = useState<PreviewDiff | null>(null);
  const [publishBlocked, setPublishBlocked] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const openFullReview = useCallback(() => {
    void navigate({
      to: "/drafts/$draftId/publish",
      params: { draftId },
    });
  }, [draftId, navigate]);

  const handleReview = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const review = await getDraftPublishReview(draftId);
      if (review.commands.length === 0) {
        toast.info("The draft has no changes to preview.");
        return;
      }
      setPublishBlocked(review.publishBlocked);
      setDiff(review.diff);
      setDialogOpen(true);
      if (review.lateBound.length > 0) {
        toast.warning("Late-bound values need binding before publish.", {
          description: "Open the full publish review to resolve them.",
          action: {
            label: "Open review",
            onClick: openFullReview,
          },
        });
      } else if (review.diff.error) {
        toast.warning("Preview failed — publish is blocked until resolved.");
      }
    } catch (err) {
      console.error("[DraftReviewPanel] failed to load draft:", err);
      setLoadError("Could not load draft. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [draftId, openFullReview]);

  const handlePublish = useCallback(async () => {
    if (publishBlocked) {
      toast.error("Publish blocked — resolve review issues first.", {
        action: {
          label: "Open review",
          onClick: openFullReview,
        },
      });
      return;
    }
    try {
      await publishDraft(draftId);
      toast.success("Draft published.");
      setDialogOpen(false);
      setPendingDraft(null);
    } catch (err) {
      console.error("[DraftReviewPanel] publish failed:", err);
      toast.error("Publish failed. Please try again.");
    }
  }, [draftId, openFullReview, publishBlocked, setPendingDraft]);

  const handleDiscard = useCallback(async () => {
    try {
      await discardDraft(draftId);
      toast.info("Draft discarded.");
      setDialogOpen(false);
      setDiff(null);
      setPendingDraft(null);
    } catch (err) {
      console.error("[DraftReviewPanel] discard failed:", err);
      toast.error("Discard failed. Please try again.");
    }
  }, [draftId, setPendingDraft]);

  const [isQuickDiscarding, setIsQuickDiscarding] = useState(false);

  const handleQuickDiscard = useCallback(async () => {
    if (isLoading || isQuickDiscarding) return;
    setIsQuickDiscarding(true);
    try {
      await discardDraft(draftId);
      toast.info("Draft discarded.");
      setPendingDraft(null);
    } catch (err) {
      console.error("[DraftReviewPanel] quick-discard failed:", err);
      toast.error("Discard failed. Please try again.");
    } finally {
      setIsQuickDiscarding(false);
    }
  }, [draftId, isLoading, isQuickDiscarding, setPendingDraft]);

  const handleDialogClose = useCallback(() => {
    setDialogOpen(false);
  }, []);

  return (
    <>
      <div className="flex h-full flex-col">
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
              <p className="mb-3 rounded-lg border border-palette-danger/30 bg-palette-danger/5 px-3 py-2 text-[11px] text-palette-danger">
                {loadError}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Button
                label={isLoading ? "Loading diff…" : "Review changes"}
                onClick={handleReview}
                disabled={isLoading || isQuickDiscarding}
                className="w-full"
                size="sm"
              />
              <Button
                label="Full publish review"
                variant="outline"
                onClick={openFullReview}
                disabled={isLoading || isQuickDiscarding}
                className="w-full"
                size="sm"
              />
              <Button
                label={isQuickDiscarding ? "Discarding…" : "Discard draft"}
                variant="ghost"
                onClick={() => void handleQuickDiscard()}
                disabled={isLoading || isQuickDiscarding}
                className="w-full text-neutral-fg-subtle hover:text-neutral-fg"
                size="sm"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-neutral-border/60 px-4 py-3">
          <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-neutral-fg-subtle">
            <SparklesIcon className="size-3 shrink-0" />
            Review the proposed changes before publishing to your project.
          </p>
        </div>
      </div>

      <PreviewDiffDialog
        diff={diff}
        open={dialogOpen}
        onClose={handleDialogClose}
        title="Review draft changes"
        onPublish={handlePublish}
        onDiscard={handleDiscard}
        publishDisabled={publishBlocked}
      />
    </>
  );
}
