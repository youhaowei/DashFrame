import { cn } from "@wystack/ui-react";
import { ShelfChipView } from "./ShelfChipView";
import { useShelfDraggable } from "./ShelfDnd";
import { removeFromShelf, type ShelfItem } from "./shelf-store";

/** A chip on the shelf: drag it out onto a target, or × to take it off. */
export function ShelfChip({ item }: { item: ShelfItem }) {
  const { setNodeRef, attributes, listeners, isDragging } = useShelfDraggable(
    item.id,
    item,
    "shelf",
  );
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-shelf-item={item.label}
      className={cn(
        "shrink-0 cursor-grab touch-none rounded-lg focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none",
        isDragging && "opacity-40",
      )}
    >
      <ShelfChipView item={item} onRemove={() => removeFromShelf(item.id)} />
    </div>
  );
}
