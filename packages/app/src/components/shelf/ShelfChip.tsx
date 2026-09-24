import { WorkbenchChip } from "@dashframe/ui";
import { cn } from "@wystack/ui-react";
import {
  CalculatorIcon,
  ChartIcon,
  DragHandleVerticalIcon,
  FileIcon,
  TextTypeIcon,
} from "@wystack/ui-react/icons";
import { Pin } from "lucide-react";
import { toast } from "sonner";
import { useCarryable } from "./drag-context";
import type { ShelfItemState } from "./shelf-model";
import {
  putOnShelf,
  removeFromShelf,
  setShelfItemPinned,
  shelfItemKey,
  type ShelfItem,
  type ShelfItemRef,
  type ShelfKind,
} from "./shelf-store";

export const SHELF_KIND_ICONS: Record<ShelfKind, typeof ChartIcon> = {
  chart: ChartIcon,
  draft: FileIcon,
  field: TextTypeIcon,
  metric: CalculatorIcon,
};

const KIND_NAMES: Record<ShelfKind, string> = {
  chart: "Chart",
  draft: "Draft",
  field: "Field",
  metric: "Metric",
};

const STORAGE_REFUSED =
  "Couldn't change the shelf: this browser's storage is full or blocked.";

/** Puts an item on the shelf, and says so when the browser refuses. */
export function keepOnShelf(ref: ShelfItemRef): void {
  if (!putOnShelf(ref)) toast.error(STORAGE_REFUSED);
}

function report(saved: boolean): void {
  if (!saved) toast.error(STORAGE_REFUSED);
}

/**
 * A chip on the shelf. Drag it out onto a target, pin it to keep it past the
 * recent limit, or × to take it off. A chip whose artifact is gone stays
 * until removed, muted and not draggable, so nothing vanishes unexplained.
 */
export function ShelfChip({
  item,
  state,
}: {
  item: ShelfItem;
  state: ShelfItemState;
}) {
  const missing = state.status === "missing";
  const ref: ShelfItemRef = {
    kind: item.kind,
    id: item.id,
    scope: item.scope,
    label: state.label,
  };
  const { setNodeRef, attributes, listeners, isDragging } = useCarryable(
    ref,
    "shelf",
    { disabled: missing },
  );
  const key = shelfItemKey(item);
  const Icon = SHELF_KIND_ICONS[item.kind];

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // Reached by pointer; the buttons inside are the keyboard path.
      role={undefined}
      tabIndex={-1}
      aria-roledescription={missing ? undefined : "draggable shelf item"}
      aria-label={`${KIND_NAMES[item.kind]}: ${state.label}${missing ? ", no longer exists" : ""}`}
      data-shelf-item={state.label}
      data-shelf-kind={item.kind}
      className={cn(
        "list-none rounded-lg focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none",
        missing ? "cursor-default" : "cursor-grab touch-none",
        isDragging && "opacity-40",
      )}
    >
      <WorkbenchChip
        // The whole chip is the handle; the nav is too narrow to spare a slot.
        dragHandle={false}
        className="pl-2"
        icon={<Icon aria-hidden />}
        stacked={missing}
        title={
          <span className={cn(missing && "text-neutral-fg-subtle italic")}>
            {state.label}
          </span>
        }
        description={missing ? "no longer exists" : undefined}
        trailing={
          missing ? null : (
            <button
              type="button"
              aria-pressed={item.pinned}
              aria-label={
                item.pinned ? `Unpin ${state.label}` : `Pin ${state.label}`
              }
              title={item.pinned ? "Unpin" : "Pin"}
              // A press here is a click, never the start of a carry.
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                report(setShelfItemPinned(key, !item.pinned));
              }}
              className={cn(
                "grid h-5 w-5 shrink-0 place-items-center rounded text-neutral-fg-subtle transition-opacity hover:bg-neutral-bg-emphasis hover:text-neutral-fg focus:opacity-100 focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none motion-reduce:transition-none",
                item.pinned
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
              )}
            >
              <Pin
                aria-hidden
                className={cn("h-3 w-3", item.pinned && "fill-current")}
              />
            </button>
          )
        }
        removeLabel={`Take ${state.label} off the shelf`}
        onRemove={() => report(removeFromShelf(key))}
      />
    </li>
  );
}

/** What follows the pointer while an item is carried. */
export function CarriedChip({ item }: { item: ShelfItemRef }) {
  const Icon = SHELF_KIND_ICONS[item.kind];
  return (
    <WorkbenchChip
      className="max-w-60 cursor-grabbing bg-neutral-bg shadow-[var(--surface-shadow)]"
      dragHandle={<DragHandleVerticalIcon aria-hidden className="h-3 w-3" />}
      icon={<Icon aria-hidden />}
      title={item.label}
      description={KIND_NAMES[item.kind]}
    />
  );
}
