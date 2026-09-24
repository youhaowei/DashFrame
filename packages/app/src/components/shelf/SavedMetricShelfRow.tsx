import type { Metric } from "@dashframe/types";
import { WorkbenchChip } from "@dashframe/ui";
import { cn } from "@wystack/ui-react";
import {
  CalculatorIcon,
  DragHandleVerticalIcon,
  PlusIcon,
} from "@wystack/ui-react/icons";
import { putOnShelf } from "./Shelf";
import { useShelfDraggable } from "./ShelfDnd";
import type { ShelfItem } from "./shelf-store";

export function metricShelfItem(metric: Metric): ShelfItem {
  return {
    id: `metric:${metric.id}`,
    kind: "metric",
    label: metric.name,
    ref: {
      tableId: metric.tableId,
      metricId: metric.id,
      aggregation: metric.aggregation,
      ...(metric.columnName ? { columnName: metric.columnName } : {}),
    },
  };
}

/** SPIKE: a table's saved metric that can be dragged onto the shelf. */
export function SavedMetricShelfRow({ metric }: { metric: Metric }) {
  const item = metricShelfItem(metric);
  const { setNodeRef, attributes, listeners, isDragging } = useShelfDraggable(
    item.id,
    item,
    "source",
  );
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-saved-metric={metric.name}
      className={cn(
        "cursor-grab touch-none rounded-lg",
        isDragging && "opacity-40",
      )}
    >
      <WorkbenchChip
        dragHandle={<DragHandleVerticalIcon aria-hidden className="h-3 w-3" />}
        icon={<CalculatorIcon aria-hidden />}
        title={metric.name}
        trailing={
          <button
            type="button"
            aria-label={`Put ${metric.name} on shelf`}
            title="Put on shelf"
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-neutral-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-neutral-bg-emphasis hover:text-neutral-fg focus:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              putOnShelf(item);
            }}
          >
            <PlusIcon aria-hidden className="h-3 w-3" />
          </button>
        }
      />
    </div>
  );
}
