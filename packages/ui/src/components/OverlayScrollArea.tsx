import { ScrollArea } from "@base-ui/react/scroll-area";
import { cn } from "@wystack/ui-react";
import type { CSSProperties, ReactNode, Ref, UIEventHandler } from "react";

/**
 * Thin scrollbar for a Base UI ScrollArea. It stays out of layout and shows
 * only while the area scrolls or the pointer is on the bar, so edge fades do
 * the everyday job of marking more content.
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
        "hover:opacity-100 hover:delay-0 data-[scrolling]:opacity-100 data-[scrolling]:delay-0 data-[scrolling]:duration-100",
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
   * header. The top fade and the vertical scrollbar start below it. Vertical
   * orientations only.
   */
  topInset?: number;
  /** Fade colour; match the surface behind the content. */
  fadeClassName?: string;
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
          <OverlayScrollbar
            // In "both", stop short of the horizontal bar so the two tracks
            // don't overlap in the corner.
            className={cn("my-1 mr-0.5", horizontal && "mb-2.5")}
            style={topInset ? { marginTop: topInset + 4 } : undefined}
          />
          <div
            aria-hidden
            className={cn(FADE_TOP, fadeClassName)}
            style={topInset ? { top: topInset } : undefined}
          />
          <div aria-hidden className={cn(FADE_BOTTOM, fadeClassName)} />
        </>
      )}
      {horizontal && (
        <>
          <OverlayScrollbar
            orientation="horizontal"
            className={cn("mx-1 mb-0.5", vertical && "mr-2.5")}
          />
          <div aria-hidden className={cn(FADE_LEFT, fadeClassName)} />
          <div aria-hidden className={cn(FADE_RIGHT, fadeClassName)} />
        </>
      )}
    </ScrollArea.Root>
  );
}
