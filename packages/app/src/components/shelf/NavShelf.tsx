import { queryStatus } from "@/data/query-status";
import { useShellStore } from "@/lib/stores/shell-store";
import { api } from "@dashframe/convex-backend/api";
import { Surface, cn } from "@wystack/ui-react";
import { ChevronDownIcon, LayersIcon } from "@wystack/ui-react/icons";
import { useQuery_experimental as useQuery } from "convex/react";
import { useCallback, useState } from "react";
import {
  useDropTarget,
  useRegisteredDropTargets,
  type DragOrigin,
  type DropVerdict,
} from "./drag-context";
import { ShelfChip, keepOnShelf } from "./ShelfChip";
import {
  partitionForPage,
  resolveShelfItem,
  type ShelfItemState,
  type ShelfLiveLists,
} from "./shelf-model";
import {
  shelfCountLabel,
  shelfItemKey,
  useShelfItems,
  type ShelfItem,
  type ShelfItemRef,
} from "./shelf-store";

/** The shelf as the current page sees it: resolved and split by use. */
export function useShelfView() {
  const items = useShelfItems();
  const targets = useRegisteredDropTargets();
  const needs = (kind: ShelfItem["kind"]) =>
    items.some((item) => item.kind === kind);

  // Each list is subscribed to only while an item of its kind is on the
  // shelf; the subscriptions are shared with the pages that show them.
  const tables = queryStatus(
    useQuery({
      query: api.app.listDataTables,
      args: needs("metric") || needs("field") ? {} : "skip",
    }),
  ).data;
  const visualizations = queryStatus(
    useQuery({
      query: api.app.listVisualizations,
      args: needs("chart") ? {} : "skip",
    }),
  ).data;
  const drafts = queryStatus(
    useQuery({ query: api.app.listDrafts, args: needs("draft") ? {} : "skip" }),
  ).data;

  const lists: ShelfLiveLists = { tables, visualizations, drafts };
  const states = new Map<string, ShelfItemState>(
    items.map((item) => [shelfItemKey(item), resolveShelfItem(item, lists)]),
  );
  const { usable, elsewhere } = partitionForPage(items, targets);
  return { items, states, usable, elsewhere };
}

function acceptOntoShelf(_item: ShelfItemRef, from: DragOrigin): DropVerdict {
  return from === "shelf"
    ? { ok: false, reason: "Already on the shelf" }
    : { ok: true, label: "Keep on the shelf" };
}

/** Makes an element a place to drop things onto the shelf. */
export function useShelfDropTarget(id: string) {
  const onDrop = useCallback((item: ShelfItemRef) => keepOnShelf(item), []);
  const target = useDropTarget({
    id,
    role: "shelf",
    accepts: acceptOntoShelf,
    onDrop,
  });
  const offered = target.verdict?.ok === true;
  return { ...target, offered, over: offered && target.isOver };
}

function dropState(offered: boolean, over: boolean) {
  if (over) return "over";
  return offered ? "offered" : undefined;
}

function GroupLabel({ children }: { children: string }) {
  return (
    <p className="px-1.5 pt-1.5 pb-0.5 text-[11px] text-neutral-fg-subtle">
      {children}
    </p>
  );
}

function ChipList({
  items,
  states,
  label,
}: {
  items: readonly ShelfItem[];
  states: Map<string, ShelfItemState>;
  label: string;
}) {
  return (
    <ul aria-label={label} className="space-y-1">
      {items.map((item) => {
        const key = shelfItemKey(item);
        return <ShelfChip key={key} item={item} state={states.get(key)!} />;
      })}
    </ul>
  );
}

/**
 * The shelf's own panel: a raised surface inside the flat nav, with a header
 * that collapses it, pinned items above recent ones, and the items no target
 * on this page takes folded into one muted row. The whole panel is a drop
 * target, collapsed or not.
 */
export function ShelfPanel({
  targetId,
  collapsible = true,
  className,
}: {
  /** Distinct per mounted panel: the nav footer and the flyout differ. */
  targetId: string;
  collapsible?: boolean;
  className?: string;
}) {
  const { items, states, usable, elsewhere } = useShelfView();
  const shelfOpen = useShellStore((s) => s.shelfOpen);
  const setShelfOpen = useShellStore((s) => s.setShelfOpen);
  const [showElsewhere, setShowElsewhere] = useState(false);
  const { setNodeRef, offered, over } = useShelfDropTarget(targetId);
  const open = !collapsible || shelfOpen;
  const pinned = usable.filter((item) => item.pinned);
  const recent = usable.filter((item) => !item.pinned);
  const bodyId = `${targetId}-body`;

  return (
    <Surface
      ref={setNodeRef}
      elevation="raised"
      role="region"
      aria-label="Shelf"
      data-shelf-panel={targetId}
      data-shelf-drop={dropState(offered, over)}
      className={cn(
        "rounded-[var(--surface-radius)] p-1 text-xs outline-1 outline-offset-2 outline-transparent transition-[outline-color] duration-150 motion-reduce:transition-none",
        offered && "outline-dashed outline-neutral-border",
        over && "outline-palette-primary",
        className,
      )}
    >
      <HeaderRow
        count={items.length}
        open={open}
        collapsible={collapsible}
        controls={bodyId}
        onToggle={() => setShelfOpen(!shelfOpen)}
      />
      {open && (
        <div id={bodyId} className="max-h-[40vh] overflow-y-auto pt-0.5">
          {items.length === 0 ? (
            <div
              className={cn(
                "flex min-h-8 items-center rounded-lg border border-dashed px-2 text-neutral-fg-subtle transition-colors duration-150 motion-reduce:transition-none",
                over
                  ? "border-palette-primary text-neutral-fg"
                  : "border-neutral-border",
              )}
            >
              Drop here to keep
            </div>
          ) : (
            <>
              {pinned.length > 0 && (
                <>
                  <GroupLabel>Pinned</GroupLabel>
                  <ChipList items={pinned} states={states} label="Pinned" />
                </>
              )}
              {recent.length > 0 && (
                <>
                  <GroupLabel>Recent</GroupLabel>
                  <ChipList items={recent} states={states} label="Recent" />
                </>
              )}
              {elsewhere.length > 0 && (
                <ElsewhereRow
                  items={elsewhere}
                  states={states}
                  expanded={showElsewhere}
                  onToggle={() => setShowElsewhere((value) => !value)}
                  controls={`${targetId}-elsewhere`}
                />
              )}
            </>
          )}
        </div>
      )}
    </Surface>
  );
}

function HeaderRow({
  count,
  open,
  collapsible,
  controls,
  onToggle,
}: {
  count: number;
  open: boolean;
  collapsible: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const content = (
    <>
      <LayersIcon aria-hidden className="h-3.5 w-3.5 text-neutral-fg-subtle" />
      <span className="font-medium text-neutral-fg">Shelf</span>
      {count > 0 && (
        <span className="text-neutral-fg-subtle tabular-nums">{count}</span>
      )}
    </>
  );
  if (!collapsible) {
    return (
      <div className="flex h-7 items-center gap-1.5 px-1.5">{content}</div>
    );
  }
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={shelfCountLabel(count)}
      onClick={onToggle}
      className="flex h-7 w-full items-center gap-1.5 rounded-lg px-1.5 text-left transition-colors hover:bg-neutral-bg-subtle focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none"
    >
      {content}
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "ml-auto h-3.5 w-3.5 text-neutral-fg-subtle transition-transform duration-150 motion-reduce:transition-none",
          !open && "-rotate-90",
        )}
      />
    </button>
  );
}

function ElsewhereRow({
  items,
  states,
  expanded,
  onToggle,
  controls,
}: {
  items: readonly ShelfItem[];
  states: Map<string, ShelfItemState>;
  expanded: boolean;
  onToggle: () => void;
  controls: string;
}) {
  return (
    <div className="pt-1">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={controls}
        onClick={onToggle}
        className="flex h-7 w-full items-center gap-1.5 rounded-lg px-1.5 text-left text-[11px] text-neutral-fg-subtle transition-colors hover:bg-neutral-bg-subtle hover:text-neutral-fg focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none"
      >
        <span>Not for this page · {items.length}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "ml-auto h-3 w-3 transition-transform duration-150 motion-reduce:transition-none",
            !expanded && "-rotate-90",
          )}
        />
      </button>
      {expanded && (
        <div id={controls} className="opacity-70">
          <ChipList items={items} states={states} label="Not for this page" />
        </div>
      )}
    </div>
  );
}
