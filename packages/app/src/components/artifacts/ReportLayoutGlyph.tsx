import type { CSSProperties } from "react";

import type { DashboardItem } from "@dashframe/types";

const GRID_COLUMNS = 12;

/**
 * A miniature of a report's own layout: each item's 12-column grid position as
 * a grey block, text items lighter than charts. An empty report draws a dashed
 * box, the house mark for "choose".
 *
 * Only the top `maxRows` grid rows are drawn: a long report would otherwise
 * shrink every block under its 1px gaps. The top of a report is also what
 * people recognise it by.
 */
export function ReportLayoutGlyph({
  items,
  className = "h-9 w-12",
  maxRows = 24,
}: {
  items: readonly Pick<
    DashboardItem,
    "id" | "type" | "x" | "y" | "width" | "height"
  >[];
  className?: string;
  maxRows?: number;
}) {
  if (items.length === 0) {
    return (
      <span
        className={`block rounded-[3px] border border-dashed border-neutral-ring ${className}`}
      />
    );
  }

  const top = Math.min(...items.map((item) => Math.max(0, item.y)));
  const blocks = items.flatMap((item) => {
    const y = Math.max(0, item.y) - top;
    if (y >= maxRows) return [];
    const x = Math.min(Math.max(0, item.x), GRID_COLUMNS - 1);
    return [
      {
        id: item.id,
        type: item.type,
        x,
        y,
        width: Math.max(1, Math.min(item.width, GRID_COLUMNS - x)),
        height: Math.max(1, Math.min(item.height, maxRows - y)),
      },
    ];
  });
  const rows = Math.max(1, ...blocks.map((block) => block.y + block.height));
  return (
    <span
      className={`grid grid-cols-12 grid-rows-[repeat(var(--rows),minmax(0,1fr))] ${className}`}
      style={{ "--rows": rows } as CSSProperties}
    >
      {blocks.map((block) => (
        <span
          key={block.id}
          data-testid="report-glyph-block"
          className={`col-[var(--col)] row-[var(--row)] m-px rounded-[2px] ${
            block.type === "markdown"
              ? "bg-neutral-bg-emphasis"
              : "bg-neutral-bg-bold"
          }`}
          style={
            {
              "--col": `${block.x + 1} / span ${block.width}`,
              "--row": `${block.y + 1} / span ${block.height}`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
