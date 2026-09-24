import type { CSSProperties } from "react";

import type { DashboardItem } from "@dashframe/types";

const GRID_COLUMNS = 12;

/**
 * A miniature of a report's own layout: each item's 12-column grid position as
 * a grey block, text items lighter than charts. An empty report draws a dashed
 * box, the house mark for "choose".
 */
export function ReportLayoutGlyph({
  items,
  className = "h-9 w-12",
}: {
  items: readonly Pick<
    DashboardItem,
    "id" | "type" | "x" | "y" | "width" | "height"
  >[];
  className?: string;
}) {
  if (items.length === 0) {
    return (
      <span
        className={`block rounded-[3px] border border-dashed border-neutral-ring ${className}`}
      />
    );
  }

  const rows = Math.max(1, ...items.map((item) => item.y + item.height));
  return (
    <span
      className={`grid grid-cols-12 grid-rows-[repeat(var(--rows),minmax(0,1fr))] ${className}`}
      style={{ "--rows": rows } as CSSProperties}
    >
      {items.map((item) => {
        const x = Math.min(Math.max(0, item.x), GRID_COLUMNS - 1);
        const width = Math.max(1, Math.min(item.width, GRID_COLUMNS - x));
        return (
          <span
            key={item.id}
            className={`col-[var(--col)] row-[var(--row)] m-px rounded-[2px] ${
              item.type === "markdown"
                ? "bg-neutral-bg-emphasis"
                : "bg-neutral-bg-bold"
            }`}
            style={
              {
                "--col": `${x + 1} / span ${width}`,
                "--row": `${Math.max(0, item.y) + 1} / span ${Math.max(1, item.height)}`,
              } as CSSProperties
            }
          />
        );
      })}
    </span>
  );
}
