import { LateBoundFixControl } from "@/components/drafts/LateBoundFixControl";
import {
  CHANGE_COLORS,
  CHANGE_LABELS,
  FLAG_COLORS,
  FLAG_LABELS,
  KIND_LABELS,
} from "@/components/preview-diff/change-details";
import { previewFailureSummary } from "@/components/preview-diff/user-facing-errors";
import type { PreviewDiff } from "@dashframe/types";
import { OverlayScrollArea } from "@dashframe/ui";
import { Badge, Button, cn } from "@wystack/ui-react";
import { AlertCircleIcon } from "@wystack/ui-react/icons";
import {
  describePath,
  type DraftChange,
  type DraftReview,
} from "./draft-review";

export interface DraftChangeListProps {
  review: DraftReview;
  changes: DraftChange[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** A failed revision or publish, in the reviewer's words. */
  reviewError: string | null;
  onRetry: () => void;
  busy: boolean;
  /** Resolves true only when the value was bound. */
  onBindValue: (
    commandIndex: number,
    jsonPath: string,
    value: string,
  ) => Promise<boolean>;
}

/**
 * The draft itself: what each change does, in the order the draft makes them.
 * A value the draft still needs is filled in right under the change that
 * needs it; everything else about a change opens in the inspector.
 */
export function DraftChangeList({
  review,
  changes,
  selectedKey,
  onSelect,
  reviewError,
  onRetry,
  busy,
  onBindValue,
}: DraftChangeListProps) {
  const diff = review.diff as PreviewDiff;
  const unbound = review.lateBound.length;
  let alert: string | null = reviewError;
  if (!alert && diff.error)
    alert = previewFailureSummary(diff.error.commandIndex);
  if (!alert && unbound > 0)
    alert = `${unbound} ${
      unbound === 1 ? "value still needs" : "values still need"
    } to be filled in before publishing.`;

  if (review.commandCount === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
        <h2 className="text-base font-semibold text-neutral-fg">
          No changes yet
        </h2>
        <p className="text-sm text-neutral-fg-subtle">
          This draft is empty. Discard it, or wait for its changes to arrive.
        </p>
      </div>
    );
  }

  return (
    <OverlayScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 p-1">
        {alert && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--surface-radius)] bg-neutral-bg px-3 py-2.5 text-palette-warning shadow-[var(--surface-shadow)]"
          >
            <AlertCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0 flex-1 text-sm font-medium">{alert}</p>
            {reviewError && (
              <Button
                variant="ghost"
                size="sm"
                label="Reload"
                onClick={onRetry}
              />
            )}
          </div>
        )}

        <ul aria-label="Changes" className="flex flex-col gap-1.5">
          {changes.map((change) => (
            <li
              key={change.key}
              // The whole card reads as selected, fix control included.
              className={cn(
                "rounded-[var(--surface-radius)] bg-neutral-bg ring-palette-primary/60 transition-shadow duration-150 motion-reduce:transition-none",
                change.key === selectedKey && "ring-1",
              )}
            >
              <ChangeButton
                change={change}
                selected={change.key === selectedKey}
                onSelect={() => onSelect(change.key)}
              />
              {change.lateBound.length > 0 && (
                <div className="space-y-3 px-3 pt-1 pb-3">
                  {change.lateBound.map((entry) => (
                    <LateBoundFixControl
                      key={`${entry.commandIndex}:${entry.jsonPath}`}
                      entry={entry}
                      disabled={busy}
                      onApply={(value) =>
                        onBindValue(entry.commandIndex, entry.jsonPath, value)
                      }
                    />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>

        {diff.affectedDownstream.length > 0 && (
          <section aria-label="Also affected" className="mt-2">
            <h3 className="px-1 pb-1.5 text-xs font-medium text-neutral-fg-subtle">
              Also affected
            </h3>
            <ul className="flex flex-col gap-0.5">
              {diff.affectedDownstream.map((node) => (
                <li
                  key={`${node.kind}:${node.nodeId}`}
                  className="flex items-center gap-2 rounded-md bg-neutral-bg/60 px-3 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-neutral-fg">
                    {node.name || node.nodeId}
                  </span>
                  <Badge variant="soft" color="secondary" className="text-xs">
                    {KIND_LABELS[node.kind]}
                  </Badge>
                  <Badge
                    variant="soft"
                    color={FLAG_COLORS[node.flag]}
                    className="text-xs"
                  >
                    {FLAG_LABELS[node.flag]}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </OverlayScrollArea>
  );
}

function ChangeButton({
  change,
  selected,
  onSelect,
}: {
  change: DraftChange;
  selected: boolean;
  onSelect: () => void;
}) {
  const needsValue = change.lateBound.length > 0;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-1 rounded-[var(--surface-radius)] px-3 py-2 text-left transition-colors duration-150 motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none",
        !selected && "hover:bg-neutral-bg-subtle",
      )}
    >
      {change.type === "node" ? (
        <>
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-neutral-fg">
              {change.node.name || change.node.nodeId}
            </span>
            <Badge
              variant="soft"
              color="secondary"
              className="shrink-0 text-xs"
            >
              {KIND_LABELS[change.node.kind]}
            </Badge>
            <Badge
              variant="soft"
              color={CHANGE_COLORS[change.node.change]}
              className="shrink-0 text-xs"
            >
              {CHANGE_LABELS[change.node.change]}
            </Badge>
            {needsValue && (
              <Badge
                variant="soft"
                color="warning"
                className="shrink-0 text-xs"
              >
                Needs a value
              </Badge>
            )}
          </span>
          {change.node.intent.length > 0 && (
            <span className="flex flex-col gap-0.5 text-xs text-neutral-fg-subtle">
              {change.node.intent.map((intent, index) => (
                <span key={`${intent.command}-${index}`}>{intent.summary}</span>
              ))}
            </span>
          )}
        </>
      ) : (
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-neutral-fg">
            {describePath(change.path)}
          </span>
          <Badge
            variant="soft"
            color={change.failing ? "danger" : "secondary"}
            className="shrink-0 text-xs"
          >
            {change.failing ? "Can't be applied" : "Not previewed"}
          </Badge>
          {needsValue && (
            <Badge variant="soft" color="warning" className="shrink-0 text-xs">
              Needs a value
            </Badge>
          )}
        </span>
      )}
    </button>
  );
}
