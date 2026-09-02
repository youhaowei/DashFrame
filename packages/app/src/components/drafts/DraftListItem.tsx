import { formatRelativeTime } from "@/lib/format-relative-time";
import { Link } from "@tanstack/react-router";
import { ArtifactCard } from "@/components/artifacts/ArtifactCollection";
import { RoutedCardActionMenuTrigger } from "@/components/RoutedCardActionMenuTrigger";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@wystack/ui-react";
import {
  ExternalLinkIcon,
  FileIcon,
  DeleteIcon,
} from "@wystack/ui-react/icons";
import { useState, useSyncExternalStore } from "react";

export interface DraftListEntry {
  draftId: string;
  createdAt: Date | string;
  commandCount: number;
  updatedAt: Date | string | null;
  kinds: Record<string, number>;
  paths: string[];
  summary: {
    directNodes: Array<{
      nodeId: string;
      kind: string;
      name: string;
      intent: Array<{ command: string; summary: string }>;
    }>;
    remainingIntentCount: number;
  };
}

function toEpoch(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Re-render every 30s so "Updated 2m ago" keeps up with the clock without the
 * list re-querying.
 *
 * The snapshot is a CACHED module-level value, not a fresh `Date.now()` per
 * call. `useSyncExternalStore` compares snapshots with `Object.is` on every
 * render and throws "The result of getSnapshot should be cached" when the value
 * changes without a store notification — a live clock read never compares equal
 * to itself. The interval advances the cached value and notifies, which is the
 * only thing that moves it. One shared interval also serves every row instead
 * of one per list item.
 *
 * Paired with `getServerNow` returning 0, which makes `formatRelativeTime`
 * render its neutral placeholder on the server snapshot instead of a value the
 * client would immediately contradict.
 */
let cachedNow = Date.now();
const nowListeners = new Set<() => void>();
let nowTimer: ReturnType<typeof setInterval> | undefined;

function subscribeNow(onStoreChange: () => void): () => void {
  // Catch up on whatever elapsed between module load (or the last unsubscribe)
  // and this mount. React re-reads the snapshot immediately after subscribing,
  // so this lands without a notification.
  cachedNow = Date.now();
  nowListeners.add(onStoreChange);
  nowTimer ??= setInterval(() => {
    cachedNow = Date.now();
    for (const listener of nowListeners) listener();
  }, 30_000);
  return () => {
    nowListeners.delete(onStoreChange);
    if (nowListeners.size === 0 && nowTimer !== undefined) {
      clearInterval(nowTimer);
      nowTimer = undefined;
    }
  };
}

function getNow(): number {
  return cachedNow;
}

function getServerNow(): number {
  return 0;
}

export function DraftListItem({
  draft,
  onDiscard,
  className,
}: {
  draft: DraftListEntry;
  onDiscard?: (draft: DraftListEntry) => Promise<void>;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const now = useSyncExternalStore(subscribeNow, getNow, getServerNow);
  const updatedMs = toEpoch(draft.updatedAt) ?? toEpoch(draft.createdAt);
  const updated = updatedMs != null ? formatRelativeTime(now, updatedMs) : "—";
  const primaryNode = draft.summary.directNodes[0];
  const intentLines = draft.summary.directNodes.flatMap((node) => node.intent);

  const discard = async () => {
    if (!onDiscard) return;
    setDiscarding(true);
    try {
      await onDiscard(draft);
    } finally {
      setDiscarding(false);
      setConfirming(false);
    }
  };

  const changeCountLabel = `${draft.commandCount} change${draft.commandCount === 1 ? "" : "s"}`;
  const proposedUpdateLabel = `${draft.commandCount} proposed update${draft.commandCount === 1 ? "" : "s"}`;
  const cardName =
    primaryNode?.name ??
    (draft.commandCount === 0 ? "No changes yet" : proposedUpdateLabel);

  return (
    <ArtifactCard
      className={className}
      to={`/drafts/${draft.draftId}`}
      name={cardName}
      icon={<FileIcon className="h-5 w-5" />}
      metadata={
        <>
          {intentLines.map((intent, index) => (
            <span key={`${intent.command}:${index}`} className="block">
              {intent.summary}
            </span>
          ))}
          {draft.summary.remainingIntentCount > 0 ? (
            <span className="block">
              +{draft.summary.remainingIntentCount} more
            </span>
          ) : null}
          <span className="mt-3 block">
            {changeCountLabel} · Updated {updated}
          </span>
        </>
      }
      actions={
        onDiscard ? (
          <DropdownMenu>
            <RoutedCardActionMenuTrigger />
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                render={
                  <Link
                    to="/drafts/$draftId"
                    params={{ draftId: draft.draftId }}
                  />
                }
              >
                <ExternalLinkIcon className="mr-2 h-4 w-4" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={discarding}
                className="text-palette-danger"
                onClick={() => setConfirming(true)}
              >
                <DeleteIcon className="mr-2 h-4 w-4" />
                Discard draft
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined
      }
      footer={
        confirming ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-neutral-fg">
              Discard{" "}
              {draft.commandCount === 1
                ? "this change"
                : `all ${draft.commandCount} changes`}
              ?
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                label="Cancel"
                disabled={discarding}
                onClick={() => setConfirming(false)}
              />
              <Button
                color="danger"
                size="sm"
                label="Discard draft"
                disabled={discarding}
                onClick={() => void discard()}
              />
            </div>
          </div>
        ) : undefined
      }
    />
  );
}
