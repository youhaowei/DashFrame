import { cn } from "@wystack/ui-react";
import { toast } from "sonner";
import { ShelfChip } from "./ShelfChip";
import { useShelfDropTarget, type ShelfVerdict } from "./ShelfDnd";
import {
  addToShelf,
  SHELF_CAPACITY,
  shelfItemKey,
  useShelfItems,
  type ShelfItem,
} from "./shelf-store";

/** Put an item on the shelf and say so when it cannot go. */
export function putOnShelf(item: ShelfItem): void {
  const result = addToShelf(item);
  if (result === "full") {
    toast.error(`The shelf holds ${SHELF_CAPACITY} items. Take one off first.`);
  } else if (result === "already") {
    toast(`${item.label} is already on the shelf`);
  }
}

/**
 * SPIKE: a strip fixed to the bottom of the Stage that carries items between
 * pages and between open tabs. It shows while it holds something, and while a
 * drag that could land on it is under way.
 */
export function Shelf() {
  const items = useShelfItems();
  const keys = new Set(items.map(shelfItemKey));
  const accepts = (item: ShelfItem, from: string): ShelfVerdict => {
    if (from === "shelf") return "Already on the shelf";
    if (keys.has(shelfItemKey(item))) return "Already on the shelf";
    if (items.length >= SHELF_CAPACITY) return "The shelf is full";
    return true;
  };
  const { setNodeRef, isOver, verdict } = useShelfDropTarget(
    "shelf",
    accepts,
    (item) => putOnShelf(item),
  );
  const dragFromSource = verdict !== null && verdict !== "Already on the shelf";
  const visible = items.length > 0 || dragFromSource;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-[var(--surface-inset)] z-20 flex justify-center px-4 transition-[opacity,transform] duration-200 motion-reduce:transition-none",
        visible ? "opacity-100" : "translate-y-2 opacity-0",
      )}
    >
      <div
        ref={setNodeRef}
        role="region"
        aria-label="Shelf"
        className={cn(
          "pointer-events-auto flex max-w-full min-h-11 items-center gap-1.5 overflow-x-auto rounded-[var(--surface-radius)] bg-neutral-bg/90 p-1.5 shadow-[var(--surface-shadow)] saturate-[1.2] backdrop-blur",
          !visible && "pointer-events-none",
          dragFromSource &&
            verdict === true &&
            "outline-1 outline-offset-2 outline-dashed outline-neutral-border",
          isOver && verdict === true && "outline-palette-primary",
        )}
      >
        {items.length === 0 ? (
          <span className="px-2 text-xs text-neutral-fg-subtle">
            {verdict === true
              ? "Drop here to carry it to another page"
              : verdict}
          </span>
        ) : (
          items.map((item) => <ShelfChip key={item.id} item={item} />)
        )}
        {items.length > 0 && dragFromSource && verdict !== true && (
          <span className="px-2 text-xs text-neutral-fg-subtle">{verdict}</span>
        )}
      </div>
    </div>
  );
}
