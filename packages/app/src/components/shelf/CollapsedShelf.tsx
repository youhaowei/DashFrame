import { cn } from "@wystack/ui-react";
import { LayersIcon } from "@wystack/ui-react/icons";
import { useRef, useState } from "react";
import { useActiveDrag } from "./drag-context";
import { ShelfPanel, useShelfDropTarget } from "./NavShelf";
import { shelfCountLabel, useShelfItems } from "./shelf-store";

const BADGE_TARGET = "shelf-badge";
const CLOSE_DELAY_MS = 150;

/**
 * The shelf while the sidebar is hidden: an icon with a count. Hovering it,
 * clicking it, or carrying something over it opens a flyout with the full
 * shelf, so a chip stays reachable as a drag source. The badge itself also
 * takes a drop.
 */
export function CollapsedShelf({ className }: { className?: string }) {
  const count = useShelfItems().length;
  const active = useActiveDrag();
  const [hovered, setHovered] = useState(false);
  const [clicked, setClicked] = useState(false);
  const [carriedOver, setCarriedOver] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { setNodeRef, over } = useShelfDropTarget(BADGE_TARGET);

  // Carrying something over the badge opens the flyout until the drag ends.
  if (over && !carriedOver) setCarriedOver(true);
  if (!active && carriedOver) setCarriedOver(false);

  // A drag out of the flyout keeps it open, so the chip being carried stays
  // mounted until it lands.
  const open =
    hovered ||
    clicked ||
    carriedOver ||
    (active !== null && active.from === "shelf");

  const enter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setHovered(true);
  };
  const leave = () => {
    closeTimer.current = setTimeout(() => setHovered(false), CLOSE_DELAY_MS);
  };

  const label = shelfCountLabel(count);

  return (
    <div
      // It sits in the top bar, which drags the window in Electron; the
      // flyout's chips must drag items instead.
      className={cn("titlebar-no-drag relative", className)}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onKeyDown={(event) => {
        if (event.key === "Escape") setClicked(false);
      }}
    >
      <button
        ref={setNodeRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls="shelf-flyout"
        title="Shelf"
        onClick={() => setClicked((value) => !value)}
        data-shelf-badge
        className={cn(
          "relative grid h-7 w-7 place-items-center rounded-md text-neutral-fg-subtle transition-colors hover:bg-neutral-bg-subtle hover:text-neutral-fg focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none",
          over && "bg-neutral-bg-subtle text-neutral-fg",
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
      </button>
      {open && (
        <div
          id="shelf-flyout"
          // Padding, not margin: the gap stays inside the hover area.
          className="absolute top-full left-0 z-50 w-60 pt-1.5"
        >
          <ShelfPanel
            targetId="shelf-flyout"
            collapsible={false}
            className="shadow-[var(--shadow-lg)]"
          />
        </div>
      )}
    </div>
  );
}
