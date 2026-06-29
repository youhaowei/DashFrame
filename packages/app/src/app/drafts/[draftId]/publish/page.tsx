import { PreviewDiffRenderer } from "@/components/preview-diff/PreviewDiffRenderer";
import { usePreviewComputeFill } from "@/components/preview-diff/usePreviewComputeFill";
import { useDraftMutations, useDraftPublishReview } from "@dashframe/core";
import { useNavigate } from "@tanstack/react-router";
import { Badge, Button, cn } from "@wystack/ui";
import {
  AlertCircleIcon,
  CheckIcon,
  DeleteIcon,
  ListIcon,
} from "@wystack/ui-icons";
import { useState } from "react";
import { toast } from "sonner";

interface DraftPublishPageProps {
  draftId: string;
}

function CommandLog({
  commands,
}: {
  commands: Array<{ path: string; args: unknown }>;
}) {
  if (commands.length === 0) {
    return (
      <div className="rounded-[var(--surface-radius)] bg-neutral-bg/50 px-3 py-2 text-sm text-neutral-fg-subtle">
        No commands in this draft.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {commands.map((command, index) => (
        <div
          key={`${command.path}:${index}`}
          className="rounded-[var(--surface-radius)] bg-neutral-bg/60 px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <Badge variant="soft" color="secondary" className="text-xs">
              {index + 1}
            </Badge>
            <span className="truncate text-sm font-medium text-neutral-fg">
              {command.path}
            </span>
          </div>
          <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-neutral-fg-subtle">
            {JSON.stringify(command.args ?? {}, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

export default function DraftPublishPage({ draftId }: DraftPublishPageProps) {
  const navigate = useNavigate();
  const { data: review, isLoading } = useDraftPublishReview(draftId);
  const { diff: filledDiff } = usePreviewComputeFill(review?.diff ?? null);
  const { publish, discard } = useDraftMutations();
  const [busy, setBusy] = useState<"publish" | "discard" | null>(null);

  const handlePublish = async () => {
    if (!review || review.publishBlocked) return;
    setBusy("publish");
    try {
      await publish(draftId);
      toast.success("Draft published");
      navigate({ to: "/" });
    } catch (error) {
      toast.error("Failed to publish draft", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleDiscard = async () => {
    setBusy("discard");
    try {
      await discard(draftId);
      toast.success("Draft discarded");
      navigate({ to: "/" });
    } catch (error) {
      toast.error("Failed to discard draft", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const blocked = review?.publishBlocked ?? true;

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-neutral-border/70 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold text-neutral-fg">
              Publish draft
            </h1>
            <Badge
              variant="soft"
              color={blocked ? "warning" : "success"}
              className="text-xs"
            >
              {blocked ? "Review required" : "Ready"}
            </Badge>
          </div>
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
            onClick={handleDiscard}
          />
          <Button
            icon={CheckIcon}
            label="Publish"
            disabled={blocked || busy !== null}
            onClick={handlePublish}
          />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-4 overflow-hidden p-4 max-lg:grid-cols-1">
        <section className="min-h-0 overflow-y-auto rounded-[var(--surface-radius)] bg-neutral-bg/45 p-4">
          {isLoading && (
            <p className="text-sm text-neutral-fg-subtle">Loading draft…</p>
          )}
          {!isLoading && review && (
            <div className="space-y-4">
              {review.lateBound.length > 0 && (
                <div
                  role="alert"
                  className="rounded-[var(--surface-radius)] bg-neutral-bg/80 px-4 py-3 shadow-[var(--surface-shadow)]"
                >
                  <div className="flex items-center gap-2 text-palette-warning">
                    <AlertCircleIcon className="h-4 w-4" />
                    <p className="text-sm font-semibold">
                      Late-bound values need binding
                    </p>
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-neutral-fg/70">
                    {review.lateBound.map((entry) => (
                      <li key={`${entry.commandIndex}:${entry.jsonPath}`}>
                        Command {entry.commandIndex + 1}, {entry.jsonPath}
                        {entry.label ? ` — ${entry.label}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {review.diff.error && (
                <div
                  role="alert"
                  className="rounded-[var(--surface-radius)] bg-neutral-bg/80 px-4 py-3 shadow-[var(--surface-shadow)]"
                >
                  <div className="flex items-center gap-2 text-palette-danger">
                    <AlertCircleIcon className="h-4 w-4" />
                    <p className="text-sm font-semibold">Preview failed</p>
                  </div>
                  <p className="mt-2 text-xs text-neutral-fg/70">
                    {review.diff.error.message}
                  </p>
                </div>
              )}
              <PreviewDiffRenderer diff={filledDiff ?? review.diff} />
            </div>
          )}
        </section>

        <aside className="min-h-0 overflow-y-auto rounded-[var(--surface-radius)] bg-neutral-bg/45 p-4">
          <div className="mb-3 flex items-center gap-2">
            <ListIcon className="h-4 w-4 text-neutral-fg-subtle" />
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
          {review && <CommandLog commands={review.commands} />}
        </aside>
      </div>
    </main>
  );
}
