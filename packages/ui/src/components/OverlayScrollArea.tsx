import { ScrollArea } from "@base-ui/react/scroll-area";
import { cn } from "@wystack/ui-react";
import type { CSSProperties, ReactNode, Ref, UIEventHandler } from "react";

/**
 * Thin scrollbar for a Base UI ScrollArea. It stays out of layout and shows
 * faintly while the pointer is over the area (after a short delay, so passing
 * over doesn't flash it) and fully while the area scrolls.
 */
export function OverlayScrollbar({
  orientation = "vertical",
  className,
  style,
}: {
  orientation?: "vertical" | "horizontal";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <ScrollArea.Scrollbar
      orientation={orientation}
      style={style}
      className={cn(
        "z-20 flex touch-none rounded-full p-0.5 opacity-0 transition-opacity delay-300 duration-300 select-none motion-reduce:transition-none",
        // Hover shows the bar at 70% and scrolling at full strength. The
        // targets differ on purpose: with the same target, a delayed hover
        // transition already under way would also delay the scroll reveal.
        "data-[hovering]:opacity-70 data-[hovering]:delay-150 data-[hovering]:duration-200 data-[scrolling]:opacity-100 data-[scrolling]:delay-0 data-[scrolling]:duration-100",
        orientation === "vertical" ? "w-2" : "h-2 flex-col",
        className,
      )}
    >
      <ScrollArea.Thumb
        className={cn(
          "rounded-full bg-neutral-fg/20 transition-colors hover:bg-neutral-fg/35",
          orientation === "vertical" ? "w-full" : "h-full",
        )}
      />
    </ScrollArea.Scrollbar>
  );
}

// Fades read the overflow attributes Base UI sets on the root. The direct-child
// selector keeps a nested scroll area's state from leaking into these fades.
const FADE =
  "pointer-events-none absolute z-10 opacity-0 transition-opacity duration-150 motion-reduce:transition-none";
const FADE_TOP = `${FADE} inset-x-0 top-0 h-6 bg-linear-to-b to-transparent [[data-overflow-y-start]>&]:opacity-100`;
const FADE_BOTTOM = `${FADE} inset-x-0 bottom-0 h-6 bg-linear-to-t to-transparent [[data-overflow-y-end]>&]:opacity-100`;
const FADE_LEFT = `${FADE} inset-y-0 left-0 w-6 bg-linear-to-r to-transparent [[data-overflow-x-start]>&]:opacity-100`;
const FADE_RIGHT = `${FADE} inset-y-0 right-0 w-6 bg-linear-to-l to-transparent [[data-overflow-x-end]>&]:opacity-100`;

export interface OverlayScrollAreaProps {
  children: ReactNode;
  /** Classes for the root, which sizes and clips the area. */
  className?: string;
  /** Classes for the scrolling viewport. */
  viewportClassName?: string;
  /** The scrolling element, for virtualizers and scroll measurement. */
  viewportRef?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  /**
   * Directions that get a scrollbar and edge fades. The viewport still
   * scrolls natively on both axes.
   */
  orientation?: "vertical" | "horizontal" | "both";
  /**
   * Height of sticky content at the top of the viewport, such as a table
   * header. The vertical scrollbar starts below it, and the top fade extends
   * under it so content dissolves as it scrolls behind. Content that should
   * sit above the fade needs a z-index above 10. Vertical orientations only.
   */
  topInset?: number;
  /** Fade colour; match the surface behind the content. */
  fadeClassName?: string;
  /**
   * "overlay" (default) shows the thin bar on hover and while scrolling.
   * "none" leaves only the edge fades, for strips too small for a bar.
   */
  scrollbar?: "overlay" | "none";
}

/**
 * Scroll area with a thin scrollbar that shows while scrolling and fades on
 * each edge that has more content past it.
 */
export function OverlayScrollArea({
  children,
  className,
  viewportClassName,
  viewportRef,
  onScroll,
  orientation = "vertical",
  topInset = 0,
  fadeClassName = "from-neutral-bg",
  scrollbar = "overlay",
}: OverlayScrollAreaProps) {
  const vertical = orientation !== "horizontal";
  const horizontal = orientation !== "vertical";
  return (
    <ScrollArea.Root
      // flex-col with min-h-0 on the viewport lets a root sized only by
      // max-height scroll; a percentage height would resolve to auto there.
      // isolate keeps the fades and bars from stacking against the page.
      className={cn(
        "relative isolate flex flex-col overflow-hidden",
        className,
      )}
    >
      <ScrollArea.Viewport
        ref={viewportRef}
        onScroll={onScroll}
        className={cn("h-full min-h-0 overscroll-contain", viewportClassName)}
      >
        {children}
      </ScrollArea.Viewport>
      {vertical && (
        <>
          {scrollbar === "overlay" && (
            <OverlayScrollbar
              // In "both", stop short of the horizontal bar so the two tracks
              // don't overlap in the corner.
              className={cn("my-1 mr-0.5", horizontal && "mb-2.5")}
              style={topInset ? { marginTop: topInset + 4 } : undefined}
            />
          )}
          <div
            aria-hidden
            className={cn(FADE_TOP, fadeClassName)}
            style={topInset ? { height: topInset + 24 } : undefined}
          />
          <div aria-hidden className={cn(FADE_BOTTOM, fadeClassName)} />
        </>
      )}
      {horizontal && (
        <>
          {scrollbar === "overlay" && (
            <OverlayScrollbar
              orientation="horizontal"
              className={cn("mx-1 mb-0.5", vertical && "mr-2.5")}
            />
          )}
          <div aria-hidden className={cn(FADE_LEFT, fadeClassName)} />
          <div aria-hidden className={cn(FADE_RIGHT, fadeClassName)} />
        </>
      )}
    </ScrollArea.Root>
  );
}
