import { formatRelativeTime } from "@/lib/format-relative-time";
import { Link } from "@tanstack/react-router";
import { Button, cn } from "@wystack/ui-react";
import { ArrowRightIcon, DeleteIcon } from "@wystack/ui-react/icons";
import { useState, useSyncExternalStore } from "react";

export interface DraftListEntry {
  draftId: string;
  createdAt: Date | string;
  commandCount: number;
  updatedAt: Date | string | null;
  kinds: Record<string, number>;
  paths: string[];
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

  return (
    <article
      className={cn(
        "group rounded-[var(--surface-radius)] bg-neutral-bg/90 px-4 py-3 shadow-[var(--surface-shadow)] transition-shadow hover:shadow-md motion-reduce:transition-none",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Link
          to="/drafts/$draftId"
          params={{ draftId: draft.draftId }}
          className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-palette-primary"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-fg">
                {draft.commandCount === 0
                  ? "No changes yet"
                  : `${draft.commandCount} changes`}
              </p>
              <p className="mt-0.5 text-xs text-neutral-fg-subtle">
                Updated {updated}
              </p>
            </div>
            <ArrowRightIcon className="size-4 shrink-0 text-neutral-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-fg motion-reduce:transform-none motion-reduce:transition-none" />
          </div>
          {draft.paths.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {draft.paths.map((path) => (
                <span
                  key={path}
                  className="font-mono text-[11px] text-neutral-fg-subtle"
                >
                  {path}
                </span>
              ))}
            </div>
          ) : null}
        </Link>
        {onDiscard ? (
          <Button
            variant="ghost"
            icon={DeleteIcon}
            iconOnly
            label="Discard draft"
            disabled={discarding}
            onClick={() => setConfirming(true)}
            className="shrink-0 text-neutral-fg-subtle"
          />
        ) : null}
      </div>
      {confirming ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--surface-radius)] bg-neutral-bg-subtle px-3 py-2">
          <p className="text-xs text-neutral-fg">
            Discard all {draft.commandCount} changes?
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
      ) : null}
    </article>
  );
}
