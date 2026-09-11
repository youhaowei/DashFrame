import { ScrollArea } from "@base-ui/react/scroll-area";
import { cn } from "@wystack/ui-react";
import type { CSSProperties } from "react";

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
        "z-20 flex rounded-full p-0.5 opacity-0 transition-opacity delay-300 duration-300",
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
