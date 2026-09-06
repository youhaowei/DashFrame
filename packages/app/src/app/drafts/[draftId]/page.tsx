import { useQuery_experimental as useQuery, useMutation } from "convex/react";
import { queryStatus } from "@/data/query-status";
import { LateBoundFixControl } from "@/components/drafts/LateBoundFixControl";
import { PreviewDiffRenderer } from "@/components/preview-diff/PreviewDiffRenderer";
import { usePreviewComputeFill } from "@/components/preview-diff/usePreviewComputeFill";
import {
  DRAFT_DRIFT_DESCRIPTION,
  draftLifecycleErrorDescription,
  isDriftError,
} from "@/components/preview-diff/user-facing-errors";
import { useAssistantStore } from "@/lib/stores/assistant-store";
import { api } from "@dashframe/convex-backend/api";
import { getConvexClient } from "@/data/runtime";
import { useNavigate } from "@tanstack/react-router";

import { Badge, Button, cn, ErrorState } from "@wystack/ui-react";
import {
  AlertCircleIcon,
  CheckIcon,
  DeleteIcon,
  ListIcon,
} from "@wystack/ui-react/icons";
import { useState } from "react";
import { toast } from "sonner";

interface DraftReviewPageProps {
  draftId: string;
}

type RevisionOp =
  | { type: "removeCommand"; commandIndex: number }
  | {
      type: "bindOperand";
      commandIndex: number;
      jsonPath: string;
      value: string;
    };

function CommandLog({
  commands,
  lateBound,
  busy,
  onRevise,
}: {
  commands: Array<{ path: string; hasArgs: boolean; lateBoundCount: number }>;
  lateBound: Array<{
    commandIndex: number;
    path: string;
    jsonPath: string;
    kind: string;
    label?: string;
    refType: "column" | "category" | "placeholder" | "unknown";
  }>;
  busy: boolean;
  /**
   * Resolves to whether the revision actually landed. `LateBoundFixControl`
   * keys its input reset on this — a swallowed failure that resolved void
   * cleared the field and made a rejected bind look applied.
   */
  onRevise: (op: RevisionOp) => Promise<boolean>;
}) {
  const [confirmingIndex, setConfirmingIndex] = useState<number | null>(null);

  if (commands.length === 0) {
    return (
      <div className="rounded-[var(--surface-radius)] bg-neutral-bg/50 px-3 py-2 text-sm text-neutral-fg-subtle">
        No commands in this draft.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {commands.map((command, index) => {
        const unresolved = lateBound.filter(
          (entry) => entry.commandIndex === index,
        );
        return (
          <div
            key={`${command.path}:${index}`}
            data-testid={`draft-command-${index}`}
            className="rounded-[var(--surface-radius)] bg-neutral-bg/60 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <Badge variant="soft" color="secondary" className="text-xs">
                {index + 1}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-fg">
                {command.path}
              </span>
              <Button
                variant="ghost"
                size="sm"
                label="Remove"
                disabled={busy}
                onClick={() => setConfirmingIndex(index)}
              />
            </div>
            <div className="mt-1 flex gap-2 text-[11px] leading-relaxed text-neutral-fg-subtle">
              <span>
                {command.hasArgs ? "Arguments present" : "No arguments"}
              </span>
              {command.lateBoundCount > 0 ? (
                <span>{command.lateBoundCount} late-bound</span>
              ) : null}
            </div>
            {unresolved.length > 0 ? (
              <div className="mt-3 space-y-3">
                {unresolved.map((entry) => (
                  <LateBoundFixControl
                    key={entry.jsonPath}
                    entry={entry}
                    disabled={busy}
                    onApply={(value) =>
                      onRevise({
                        type: "bindOperand",
                        commandIndex: index,
                        jsonPath: entry.jsonPath,
                        value,
                      })
                    }
                  />
                ))}
              </div>
            ) : null}
            {confirmingIndex === index ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--surface-radius)] bg-neutral-bg-subtle px-3 py-2">
                <p className="text-xs text-neutral-fg">
                  Remove this change from the draft?
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    label="Cancel"
                    disabled={busy}
                    onClick={() => setConfirmingIndex(null)}
                  />
                  <Button
                    color="danger"
                    size="sm"
                    label="Remove"
                    disabled={busy}
                    onClick={async () => {
                      await onRevise({
                        type: "removeCommand",
                        commandIndex: index,
                      });
                      setConfirmingIndex(null);
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Why Publish is disabled, for the two block reasons nothing else on this page
 * explains. Late-bound values and a load failure already raise the alert in the
 * diff pane; a gone or empty draft rendered as a bare "Review required" badge
 * over an empty diff — "something is wrong" with no way to tell what, or
 * whether the reviewer can do anything about it.
 *
 * Returns undefined for the reasons that ARE explained elsewhere, so this never
 * doubles up on the alert.
 */
function PublishBlockedReason({
  review,
}: {
  review: { draftExists: boolean; commandCount: number } | undefined;
}) {
  if (review === undefined) return null;
  let reason: string | undefined;
  if (!review.draftExists) {
    reason =
      "This draft is no longer available — it was already published or discarded.";
  } else if (review.commandCount === 0) {
    reason = "This draft has no changes to publish.";
  }
  if (reason === undefined) return null;
  return <p className="mt-1 text-xs text-palette-warning">{reason}</p>;
}

export default function DraftReviewPage({ draftId }: DraftReviewPageProps) {
  const navigate = useNavigate();
  const setPendingDraft = useAssistantStore((state) => state.setPendingDraft);
  const {
    data: review,
    isLoading,
    isError,
  } = queryStatus(
    useQuery({ query: api.app.draftPublishReview, args: { draftId } }),
  );
  const { data: openDrafts = [] } = queryStatus(
    useQuery({ query: api.app.listDrafts, args: {} }),
  );
  const { diff: filledDiff } = usePreviewComputeFill(review?.diff ?? null);
  const publish = useMutation(api.app.publishDraft);
  const discard = useMutation(api.app.discardDraft);
  const revise = useMutation(api.app.reviseDraft);
  const [busy, setBusy] = useState<"publish" | "discard" | "revise" | null>(
    null,
  );
  const [discardConfirming, setDiscardConfirming] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const handlePublish = async () => {
    if (!review || review.publishBlocked) return;
    setBusy("publish");
    setReviewError(null);
    try {
      await publish({
        draftId,
        expectedCommandCount: String(review.commandCount),
        expectedLogSignature: review.logSignature,
      });
      if (useAssistantStore.getState().pendingDraftId === draftId) {
        setPendingDraft(null);
      }
      toast.success("Draft published");
      let remaining = openDrafts.filter((draft) => draft.draftId !== draftId);
      try {
        remaining = await getConvexClient().query(api.app.listDrafts, {});
      } catch {
        // Publishing has already succeeded, so a failed refresh must not fail
        // the action. Fall through on the optimistic list computed above —
        // this draft removed from the drafts already in hand.
      }
      navigate({ to: remaining.length > 0 ? "/drafts" : "/", replace: true });
    } catch (error) {
      const message = isDriftError(error)
        ? DRAFT_DRIFT_DESCRIPTION
        : draftLifecycleErrorDescription(error);
      setReviewError(message);
      toast.error("Failed to publish draft", { description: message });
    } finally {
      setBusy(null);
    }
  };

  const handleDiscard = async () => {
    setBusy("discard");
    try {
      await discard({ draftId });
      if (useAssistantStore.getState().pendingDraftId === draftId) {
        setPendingDraft(null);
      }
      toast.success("Draft discarded");
      navigate({ to: "/drafts", replace: true });
    } catch (error) {
      toast.error("Failed to discard draft", {
        description: isDriftError(error)
          ? DRAFT_DRIFT_DESCRIPTION
          : draftLifecycleErrorDescription(error),
      });
    } finally {
      setBusy(null);
      setDiscardConfirming(false);
    }
  };

  const handleRevise = async (op: RevisionOp): Promise<boolean> => {
    if (!review) return false;
    setBusy("revise");
    setReviewError(null);
    try {
      await revise({
        draftId,
        expectedLogSignature: review.logSignature,
        ops: [op],
      });
      return true;
    } catch (error) {
      setReviewError(
        isDriftError(error)
          ? DRAFT_DRIFT_DESCRIPTION
          : draftLifecycleErrorDescription(error),
      );
      return false;
    } finally {
      setBusy(null);
    }
  };

  const blocked = review?.publishBlocked ?? true;

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold text-neutral-fg">
              Review changes
            </h1>
            <Badge
              variant="soft"
              color={blocked ? "warning" : "success"}
              className="text-xs"
            >
              {blocked ? "Review required" : "Ready"}
            </Badge>
          </div>
          <PublishBlockedReason review={review} />
          <p className="mt-1 truncate text-xs text-neutral-fg-subtle">
            {draftId}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            icon={DeleteIcon}
            label="Discard"
            disabled={busy !== null}
            onClick={() => setDiscardConfirming(true)}
          />
          <Button
            icon={CheckIcon}
            label="Publish"
            disabled={blocked || busy !== null}
            onClick={() => void handlePublish()}
          />
        </div>
        {discardConfirming && review ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-[var(--surface-radius)] bg-neutral-bg-subtle px-3 py-2">
            <p className="text-xs text-neutral-fg">
              Discard all {review.commandCount} changes?
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                label="Cancel"
                disabled={busy !== null}
                onClick={() => setDiscardConfirming(false)}
              />
              <Button
                color="danger"
                size="sm"
                label="Discard draft"
                disabled={busy !== null}
                onClick={() => void handleDiscard()}
              />
            </div>
          </div>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-4 overflow-hidden p-4 max-lg:grid-cols-1">
        <section className="min-h-0 overflow-y-auto rounded-[var(--surface-radius)] bg-neutral-bg/45 p-4">
          {isLoading ? (
            <p className="text-sm text-neutral-fg-subtle">Loading draft…</p>
          ) : null}
          {!isLoading && isError ? (
            <ErrorState
              title="Failed to load review"
              description="Could not load this draft review. Please try again."
              retryAction={{
                label: "Retry",
                onClick: () => globalThis.location.reload(),
              }}
              className="min-h-[120px]"
            />
          ) : null}
          {!isLoading && !isError && review ? (
            <div className="space-y-4">
              {(review.lateBound.length > 0 || reviewError) && (
                <div
                  role="alert"
                  className="rounded-[var(--surface-radius)] bg-neutral-bg/90 px-4 py-3 shadow-[var(--surface-shadow)]"
                >
                  <div className="flex items-start gap-2 text-palette-warning">
                    <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">
                        {reviewError ??
                          `${review.lateBound.length} values still need to be filled in before publishing.`}
                      </p>
                      {reviewError ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          label="Retry"
                          className="mt-2"
                          onClick={() => {
                            setReviewError(null);
                            globalThis.location.reload();
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
              <PreviewDiffRenderer diff={filledDiff ?? review.diff} />
            </div>
          ) : null}
        </section>

        <aside className="min-h-0 overflow-y-auto rounded-[var(--surface-radius)] bg-neutral-bg/45 p-4">
          <div className="mb-3 flex items-center gap-2">
            <ListIcon className="size-4 text-neutral-fg-subtle" />
            <h2 className="text-sm font-semibold text-neutral-fg">
              Command log
            </h2>
          </div>
          <div
            className={cn(
              "text-xs text-neutral-fg-subtle",
              review?.commands.length ? "mb-3" : "mb-0",
            )}
          >
            {review?.commands.length ?? 0} command
            {(review?.commands.length ?? 0) === 1 ? "" : "s"}
          </div>
          {review ? (
            <CommandLog
              commands={review.commands}
              lateBound={review.lateBound}
              busy={busy !== null}
              onRevise={handleRevise}
            />
          ) : null}
        </aside>
      </div>
    </main>
  );
}
