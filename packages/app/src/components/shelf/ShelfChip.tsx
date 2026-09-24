import { WorkbenchChip } from "@dashframe/ui";
import { cn } from "@wystack/ui-react";
import {
  CalculatorIcon,
  ChartIcon,
  CloseIcon,
  DragHandleVerticalIcon,
} from "@wystack/ui-react/icons";
import { Pin } from "lucide-react";
import { useCarryable, useHasPageTargets } from "./drag-context";
import { useShelf } from "./shelf-scope";
import type { ShelfItemState } from "./shelf-model";
import {
  shelfItemKey,
  type ShelfItem,
  type ShelfItemRef,
  type ShelfKind,
} from "./shelf-store";

export const SHELF_KIND_ICONS: Record<ShelfKind, typeof ChartIcon> = {
  chart: ChartIcon,
  metric: CalculatorIcon,
};

const KIND_NAMES: Record<ShelfKind, string> = {
  chart: "Chart",
  metric: "Metric",
};

/**
 * A chip on the shelf. Drag it out onto a target on the page (it offers no
 * drag while the page has none), pin it to keep it past the recent limit, or
 * × to take it off. A chip whose artifact is gone stays until removed, muted
 * and not draggable, so nothing vanishes unexplained.
 */
export function ShelfChip({
  item,
  state,
}: {
  item: ShelfItem;
  state: ShelfItemState;
}) {
  const missing = state.status === "missing";
  // Carrying needs somewhere to land: a gone artifact has nothing to carry,
  // and with no page target mounted the only target is the shelf itself.
  const hasPageTargets = useHasPageTargets();
  const carryable = !missing && hasPageTargets;
  const ref: ShelfItemRef = {
    kind: item.kind,
    id: item.id,
    scope: item.scope,
    label: state.label,
  };
  const { handleProps, isDragging } = useCarryable(ref, "shelf", {
    disabled: !carryable,
  });
  const { pin, remove } = useShelf();
  const key = shelfItemKey(item);
  const Icon = SHELF_KIND_ICONS[item.kind];

  const reveal =
    "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100";
  const rowButton =
    "grid h-5 w-5 shrink-0 place-items-center rounded text-neutral-fg-subtle transition-opacity motion-reduce:transition-none hover:bg-neutral-fg/[0.06] hover:text-neutral-fg focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none";

  // Set like a nav row: flat, icon and label on one line, a light tonal fill
  // on hover, and its pin and × revealed on hover or focus.
  return (
    <li
      {...handleProps}
      aria-label={`${KIND_NAMES[item.kind]}: ${state.label}${missing ? ", no longer exists" : ""}`}
      data-shelf-item={state.label}
      data-shelf-kind={item.kind}
      className={cn(
        "group flex min-h-7 list-none items-center gap-2 rounded-md px-2 py-1 text-neutral-fg-subtle transition-colors motion-reduce:transition-none hover:bg-neutral-fg/[0.035] hover:text-neutral-fg focus-within:bg-neutral-fg/[0.035]",
        carryable ? "cursor-grab touch-none" : "cursor-default",
        isDragging && "opacity-40",
      )}
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate", missing && "italic opacity-70")}>
          {state.label}
        </span>
        {missing && (
          <span className="truncate text-[11px] opacity-70">
            no longer exists
          </span>
        )}
      </span>
      {!missing && (
        <button
          type="button"
          aria-pressed={item.pinned}
          aria-label={
            item.pinned ? `Unpin ${state.label}` : `Pin ${state.label}`
          }
          title={item.pinned ? "Unpin" : "Pin"}
          onClick={() => pin(key, !item.pinned)}
          className={cn(rowButton, item.pinned ? "opacity-100" : reveal)}
        >
          <Pin
            aria-hidden
            className={cn("h-3 w-3", item.pinned && "fill-current")}
          />
        </button>
      )}
      <button
        type="button"
        aria-label={`Take ${state.label} off shelf`}
        title="Take off shelf"
        onClick={() => remove(key)}
        className={cn(rowButton, reveal)}
      >
        <CloseIcon aria-hidden className="h-3 w-3" />
      </button>
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
