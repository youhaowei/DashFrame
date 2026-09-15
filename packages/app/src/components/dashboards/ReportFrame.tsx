/**
 * The report editor's frame: lays the report out at a chosen width and zooms
 * it to fit between the workbench panes.
 *
 * Reports are fluid: the grid lays out at whatever width the page gives it,
 * and a grid laid out narrower draws different charts (axis labels, bar
 * widths, wrapping). By default the frame uses the width the view page would
 * have in this window — canvas plus panes — so editing previews what readers
 * see. Authors can pick another width to check how the report reflows there.
 */

import { cn } from "@wystack/ui-react";
import {
  useEffect,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

export const MIN_FRAME_WIDTH = 320;
export const MAX_FRAME_WIDTH = 2560;

const clampWidth = (width: number) =>
  Math.round(Math.min(MAX_FRAME_WIDTH, Math.max(MIN_FRAME_WIDTH, width)));

/**
 * Measures the canvas and the pane beside it. Pass `setCanvas` as the ref of
 * the scrolling canvas and `setPane` as the ref of the attached pane.
 *
 * `width: null` lays out at the reader's width in this window; `zoom: null`
 * scales the frame down to fit the canvas.
 */
export function useReportFrame({
  width: chosenWidth,
  zoom,
}: {
  width: number | null;
  zoom: number | null;
}) {
  const [canvas, setCanvas] = useState<HTMLElement | null>(null);
  const [pane, setPane] = useState<HTMLElement | null>(null);
  const [measured, setMeasured] = useState({ canvasWidth: 0, readerWidth: 0 });
  // Held while the frame edge is dragged, so the frame doesn't rescale under
  // the pointer as its width changes.
  const [heldScale, setHeldScale] = useState<number | null>(null);

  useEffect(() => {
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(canvas);
      const padding =
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight);
      const canvasWidth = canvas.clientWidth - padding;
      const readerWidth = canvasWidth + (pane?.offsetWidth ?? 0);
      if (canvasWidth <= 0 || readerWidth <= 0) return;
      setMeasured({ canvasWidth, readerWidth });
    });
    observer.observe(canvas);
    if (pane) observer.observe(pane);
    return () => observer.disconnect();
  }, [canvas, pane]);

  const width = chosenWidth ?? measured.readerWidth;
  const fit =
    width > 0 && measured.canvasWidth > 0
      ? Math.min(1, measured.canvasWidth / width)
      : 1;
  const scale = heldScale ?? zoom ?? fit;

  return {
    setCanvas,
    setPane,
    width,
    scale,
    holdScale: (held: boolean) => setHeldScale(held ? scale : null),
  };
}

export function ReportFrame({
  width,
  scale,
  onResize,
  onResizingChange,
  children,
}: {
  width: number;
  scale: number;
  /** Shows a draggable edge that sets the width. Omit when not editing. */
  onResize?: (width: number) => void;
  onResizingChange?: (resizing: boolean) => void;
  children: ReactNode;
}) {
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!content) return;
    const observer = new ResizeObserver(() =>
      setContentHeight(content.offsetHeight),
    );
    observer.observe(content);
    return () => observer.disconnect();
  }, [content]);

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!onResize || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    onResizingChange?.(true);
    const onMove = (move: globalThis.PointerEvent) => {
      // The frame is centred, so its edge travels half as far as the width.
      onResize(clampWidth(startWidth + (2 * (move.clientX - startX)) / scale));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onResizingChange?.(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onResize) return;
    const step = event.shiftKey ? 160 : 16;
    if (event.key === "ArrowLeft") onResize(clampWidth(width - step));
    else if (event.key === "ArrowRight") onResize(clampWidth(width + step));
    else return;
    event.preventDefault();
  };

  return (
    <div className={width > 0 ? "relative mx-auto w-fit" : "relative"}>
      {/* A transform doesn't change layout size, so the frame takes the
          scaled size and clips the unscaled box that would otherwise scroll. */}
      <div
        className={cn(
          "overflow-clip",
          // While editing, the frame reads as a page so a narrow width shows
          // where the report ends.
          onResize &&
            "rounded-[var(--inner-radius)] bg-neutral-bg shadow-[var(--surface-shadow)]",
        )}
        style={{
          width: width > 0 ? width * scale : undefined,
          height: contentHeight === null ? undefined : contentHeight * scale,
        }}
      >
        <div
          ref={setContent}
          className="origin-top-left"
          style={{
            width: width > 0 ? width : undefined,
            transform: scale === 1 ? undefined : `scale(${scale})`,
          }}
        >
          {children}
        </div>
      </div>
      {onResize && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Report width"
          aria-valuenow={Math.round(width)}
          aria-valuemin={MIN_FRAME_WIDTH}
          aria-valuemax={MAX_FRAME_WIDTH}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={nudge}
          className="group absolute top-0 -right-5 bottom-0 flex w-4 cursor-ew-resize touch-none items-start justify-center outline-none"
        >
          {/* The grip stays in view on tall reports; the whole strip drags. */}
          <span className="sticky top-[40vh] mt-24 h-11 w-1 rounded-full bg-neutral-border transition-colors group-hover:bg-neutral-fg-subtle group-focus-visible:bg-palette-primary motion-reduce:transition-none" />
        </div>
      )}
    </div>
  );
}
