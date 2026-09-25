import type { DashboardItem, Visualization } from "@dashframe/types";
import { type CSSProperties, useEffect, useState } from "react";

import { VisualizationPreview } from "@/components/visualizations/VisualizationPreview";

const GRID_COLUMNS = 12;

/**
 * Twelve rows fill the 16:10 frame at about the report's own proportions: a
 * 60px row is roughly 0.65 of a column on a desktop report, and 12 rows of a
 * 12-column grid in a 16:10 box give 0.625. A new report's first chart (6×6)
 * fills the top-left quarter, which is still readable at tile size.
 */
export const MINIATURE_ROWS = 12;

/** Live charts per tile; each one is a query, so the rest stay placeholders. */
export const MINIATURE_LIVE_CHARTS = 6;

type MiniatureItem = Pick<
  DashboardItem,
  "id" | "type" | "visualizationId" | "x" | "y" | "width" | "height"
>;

/**
 * Mounts children once the element comes within `rootMargin` of the
 * viewport, and keeps them mounted after that, so scrolling back does not
 * re-run the queries. Without IntersectionObserver it mounts at once.
 */
function useSeenOnce(rootMargin: string) {
  // A callback ref in state, so the observer follows the element when an
  // empty report's frame is replaced by its layout.
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (seen || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, rootMargin, seen]);

  return { ref, seen };
}

function MutedBlock() {
  return (
    <div
      data-testid="miniature-muted"
      className="h-full w-full bg-neutral-bg-emphasis"
    />
  );
}

/**
 * A report's media strip: its real 12-column layout in a 16:10 frame, each
 * chart a live thumbnail and each text block a few muted bars. An empty
 * report draws a dashed frame, the house mark for "choose".
 *
 * Only the top rows are drawn, and only the first charts in reading order
 * are live; the rest render as muted blocks. Charts mount once the tile
 * nears the viewport.
 */
export function ReportMiniature({
  items,
  visualizationById,
  maxRows = MINIATURE_ROWS,
  maxLiveCharts = MINIATURE_LIVE_CHARTS,
}: {
  items: readonly MiniatureItem[];
  visualizationById: ReadonlyMap<string, Visualization>;
  maxRows?: number;
  maxLiveCharts?: number;
}) {
  const { ref, seen } = useSeenOnce("200px");

  if (items.length === 0) {
    return (
      <div
        aria-hidden="true"
        data-testid="report-miniature"
        className="relative aspect-[16/10] w-full"
      >
        <span
          data-testid="miniature-empty"
          className="absolute inset-2.5 rounded-md border border-dashed border-neutral-ring"
        />
      </div>
    );
  }

  const top = Math.min(...items.map((item) => Math.max(0, item.y)));
  const blocks = items
    .flatMap((item) => {
      const y = Math.max(0, item.y) - top;
      if (y >= maxRows) return [];
      const x = Math.min(Math.max(0, item.x), GRID_COLUMNS - 1);
      return [
        {
          item,
          x,
          y,
          width: Math.max(1, Math.min(item.width, GRID_COLUMNS - x)),
          height: Math.max(1, Math.min(item.height, maxRows - y)),
        },
      ];
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);

  // The first charts in reading order that still resolve go live.
  const liveIds = new Set(
    blocks
      .filter(
        ({ item }) =>
          item.type === "visualization" &&
          item.visualizationId !== undefined &&
          visualizationById.has(item.visualizationId),
      )
      .slice(0, maxLiveCharts)
      .map(({ item }) => item.id),
  );

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-testid="report-miniature"
      className="grid aspect-[16/10] w-full grid-cols-12 grid-rows-[repeat(var(--rows),minmax(0,1fr))] overflow-hidden p-1.5"
      style={{ "--rows": maxRows } as CSSProperties}
    >
      {blocks.map((block) => {
        const style = {
          "--col": `${block.x + 1} / span ${block.width}`,
          "--row": `${block.y + 1} / span ${block.height}`,
        } as CSSProperties;
        const cell =
          "col-[var(--col)] row-[var(--row)] m-0.5 min-h-0 min-w-0 overflow-hidden rounded-[3px]";

        if (block.item.type === "markdown") {
          return (
            <div
              key={block.item.id}
              data-testid="miniature-text"
              className={`${cell} flex flex-col gap-1 p-1`}
              style={style}
            >
              <span className="block h-1 w-1/2 shrink-0 rounded-full bg-neutral-bg-bold" />
              <span className="block h-1 w-5/6 shrink-0 rounded-full bg-neutral-bg-bold" />
            </div>
          );
        }

        const visualization = block.item.visualizationId
          ? visualizationById.get(block.item.visualizationId)
          : undefined;
        const live = visualization !== undefined && liveIds.has(block.item.id);

        return (
          <div
            key={block.item.id}
            data-testid="miniature-chart"
            className={`${cell} bg-neutral-bg dark:bg-neutral-bg-muted`}
            style={style}
          >
            {live && seen ? (
              <div className="h-full w-full transition-opacity duration-200 starting:opacity-0 motion-reduce:transition-none">
                <VisualizationPreview
                  visualization={visualization}
                  height="container"
                  fallback={<MutedBlock />}
                />
              </div>
            ) : (
              <MutedBlock />
            )}
          </div>
        );
      })}
    </div>
  );
}
