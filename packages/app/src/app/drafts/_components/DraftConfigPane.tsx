import { KIND_LABELS } from "@/components/preview-diff/change-details";
import type { PreviewDiff } from "@dashframe/types";
import { OverlayScrollArea, WorkbenchPaneHeader } from "@dashframe/ui";
import { cn } from "@wystack/ui-react";
import type { ReactNode } from "react";
import {
  draftStatus,
  type DraftReview,
  type DraftSummary,
} from "./draft-review";

const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTime(value: string | null): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : DATE_TIME.format(ms);
}

/** A label above its value, as every pane control reads. */
function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] text-neutral-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-xs break-words text-neutral-fg">
        {children}
      </dd>
    </div>
  );
}

/** The channel the draft arrived through; it does not name who drove it. */
const ORIGIN_COPY: Record<DraftSummary["createdBy"], string> = {
  user: "This app",
  service: "The API, with an access key",
};

export interface DraftConfigPaneProps {
  draft: DraftSummary;
  /** Undefined while the review loads; the list facts show meanwhile. */
  review: DraftReview | undefined;
  /** How many changes the centre lists; undefined until the review loads. */
  changeCount: number | undefined;
}

/**
 * The left pane of a draft: where it came from, what it touches, and whether
 * it can publish. Only facts that change the decision to publish are shown.
 */
export function DraftConfigPane({
  draft,
  review,
  changeCount,
}: DraftConfigPaneProps) {
  const status = review ? draftStatus(review) : null;
  const created = formatTime(draft.createdAt);
  const updated = formatTime(draft.updatedAt);
  const diff = review?.diff as PreviewDiff | undefined;
  const kinds = [
    ...new Set(diff?.directNodes.map((node) => KIND_LABELS[node.kind]) ?? []),
  ];
  const affected = diff?.affectedDownstream.length ?? 0;

  return (
    <div className="flex h-full flex-col bg-neutral-bg text-xs">
      <WorkbenchPaneHeader title="Draft">{null}</WorkbenchPaneHeader>
      <OverlayScrollArea className="min-h-0 flex-1">
        <dl className="space-y-4 px-3.5 pb-4">
          {status && (
            <Setting label="Status">
              <span
                className={cn(
                  status.tone === "ready"
                    ? "text-palette-success"
                    : "text-palette-warning",
                )}
              >
                {status.label}
              </span>
            </Setting>
          )}

          <Setting label="Made through">{ORIGIN_COPY[draft.createdBy]}</Setting>

          {created && (
            <Setting label="Created">
              {created}
              {updated && updated !== created && (
                <span className="block text-neutral-fg-subtle">
                  Updated {updated}
                </span>
              )}
            </Setting>
          )}

          <Setting label="Changes">
            {/* Counts the cards the centre shows; the steps behind them are
                what the inspector lists and removes. */}
            {changeCount !== undefined && (
              <span className="block">
                {`${changeCount} change${changeCount === 1 ? "" : "s"}`}
              </span>
            )}
            <span className="block">
              {`${draft.commandCount} step${draft.commandCount === 1 ? "" : "s"}`}
            </span>
            {kinds.length > 0 && (
              <span className="block text-neutral-fg-subtle">
                {kinds.join(", ")}
              </span>
            )}
          </Setting>

          {affected > 0 && (
            <Setting label="Also affected">
              {affected} item{affected === 1 ? "" : "s"} downstream
            </Setting>
          )}
        </dl>
      </OverlayScrollArea>
    </div>
  );
}
