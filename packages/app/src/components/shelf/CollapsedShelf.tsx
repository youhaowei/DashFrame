import { Popover, PopoverContent, PopoverTrigger, cn } from "@wystack/ui-react";
import { LayersIcon } from "@wystack/ui-react/icons";
import { useState } from "react";
import { useActiveDrag } from "./drag-context";
import { ShelfPanel, useShelfDropTarget } from "./NavShelf";
import { shelfCountLabel, useShelfItems } from "./shelf-store";

const BADGE_TARGET = "shelf-badge";
const CLOSE_DELAY_MS = 150;

/**
 * The shelf while the sidebar is hidden: an icon with a count. Hovering or
 * clicking it opens a popover with the full shelf, and so does carrying
 * something over it, so a chip stays reachable as a drag source. The badge
 * itself also takes a drop.
 */
export function CollapsedShelf({ className }: { className?: string }) {
  const count = useShelfItems().length;
  const active = useActiveDrag();
  const [requested, setRequested] = useState(false);
  const [carriedOver, setCarriedOver] = useState(false);
  const { setNodeRef, over } = useShelfDropTarget(BADGE_TARGET);

  // Carrying something over the badge opens the shelf until the drag ends.
  if (over && !carriedOver) setCarriedOver(true);
  if (!active && carriedOver) setCarriedOver(false);

  // While a drag is under way the popover stays open: the chip being carried
  // out of it stays mounted until it lands, and one carried in has somewhere
  // to go.
  const held = carriedOver || active?.from === "shelf";
  const open = requested || held;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && held) return;
        setRequested(next);
      }}
    >
      <PopoverTrigger
        ref={setNodeRef}
        openOnHover
        delay={0}
        closeDelay={CLOSE_DELAY_MS}
        aria-label={shelfCountLabel(count)}
        title="Shelf"
        data-shelf-badge
        className={cn(
          "relative grid h-7 w-7 place-items-center rounded-md text-neutral-fg-subtle transition-colors hover:bg-neutral-bg-subtle hover:text-neutral-fg focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none motion-reduce:transition-none",
          over && "bg-neutral-bg-subtle text-neutral-fg",
          className,
        )}
      >
        <LayersIcon aria-hidden className="h-4 w-4" />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-neutral-fg px-1 text-[9px] leading-none font-semibold text-neutral-bg tabular-nums"
          >
            {count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        // The panel is the surface; the popup only positions it.
        className="w-60 rounded-none border-0 bg-transparent p-0 shadow-none"
      >
        <ShelfPanel
          targetId="shelf-flyout"
          collapsible={false}
          // The popup is the one floating form of the shelf.
          className="rounded-[var(--surface-radius)] bg-neutral-bg p-1 shadow-[var(--shadow-lg)]"
        />
      </PopoverContent>
    </Popover>
  );
}
