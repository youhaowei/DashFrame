/**
 * Keeps the report editor a faithful preview while side panes take room.
 *
 * Reports are fluid: the grid lays out at whatever width the page gives it.
 * The editor's attached panes narrow the canvas, and a grid laid out narrower
 * draws different charts (axis labels, bar widths, wrapping). So the editor
 * lays the grid out at the width the view page would have in this window —
 * canvas plus panes — and scales it down to fit between the panes.
 */

import { useEffect, useState, type ReactNode } from "react";

/**
 * Measures the canvas and the panes beside it. Pass `setCanvas` as the ref of
 * the scrolling canvas and `setPane` as the ref of the attached pane.
 */
export function useReaderWidthScale() {
  const [canvas, setCanvas] = useState<HTMLElement | null>(null);
  const [pane, setPane] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState({ readerWidth: 0, scale: 1 });

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
      setSize({ readerWidth, scale: Math.min(1, canvasWidth / readerWidth) });
    });
    observer.observe(canvas);
    if (pane) observer.observe(pane);
    return () => observer.disconnect();
  }, [canvas, pane]);

  return { setCanvas, setPane, ...size };
}

export function ReaderWidthFrame({
  readerWidth,
  scale,
  children,
}: {
  readerWidth: number;
  scale: number;
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

  return (
    // A transform doesn't change layout size, so the frame takes the scaled
    // height and clips the unscaled width that would otherwise scroll sideways.
    <div
      className="overflow-x-clip"
      style={{
        height: contentHeight === null ? undefined : contentHeight * scale,
      }}
    >
      <div
        ref={setContent}
        className="origin-top-left"
        style={{
          width: readerWidth > 0 ? readerWidth : undefined,
          transform: scale < 1 ? `scale(${scale})` : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
