/**
 * Things a page offers for the shelf: a row to drag, or a button to press.
 * Every source has both, so carrying never depends on a pointer.
 */
import { queryStatus } from "@/data/query-status";
import { api } from "@dashframe/convex-backend/api";
import type { Metric } from "@dashframe/types";
import { WorkbenchChip } from "@dashframe/ui";
import { Button, cn } from "@wystack/ui-react";
import {
  CalculatorIcon,
  DragHandleVerticalIcon,
  LayersIcon,
  PlusIcon,
} from "@wystack/ui-react/icons";
import { useQuery_experimental as useQuery } from "convex/react";
import { useCarryable } from "./drag-context";
import { useShelf } from "./shelf-scope";
import type { ShelfItemRef } from "./shelf-store";

export function metricShelfRef(metric: Metric): ShelfItemRef {
  return {
    kind: "metric",
    id: metric.id,
    scope: metric.tableId,
    label: metric.name,
  };
}

/** A table's saved metric: drag it onto the shelf, or press +. */
function SavedMetricRow({ metric }: { metric: Metric }) {
  const ref = metricShelfRef(metric);
  const { put } = useShelf();
  const { handleProps, isDragging } = useCarryable(ref, "source");
  return (
    <li
      {...handleProps}
      data-saved-metric={metric.name}
      className={cn(
        "cursor-grab touch-none list-none rounded-lg",
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
            onClick={(event) => {
              event.stopPropagation();
              put(ref);
            }}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-neutral-fg-subtle opacity-0 transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-neutral-bg-emphasis hover:text-neutral-fg focus:opacity-100 focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none"
          >
            <PlusIcon aria-hidden className="h-3 w-3" />
          </button>
        }
      />
    </li>
  );
}

/**
 * The open table's saved metrics, so one can be carried to a chart on
 * another page. Absent when the table has none.
 */
export function SavedMetricsList({ metrics }: { metrics: readonly Metric[] }) {
  if (metrics.length === 0) return null;
  return (
    <section aria-labelledby="saved-metrics-heading" className="space-y-1">
      <h3
        id="saved-metrics-heading"
        className="text-[11px] text-neutral-fg-subtle"
      >
        Saved metrics
      </h3>
      <ul className="space-y-1">
        {metrics.map((metric) => (
          <SavedMetricRow key={metric.id} metric={metric} />
        ))}
      </ul>
    </section>
  );
}

interface ShelfChart {
  id: string;
  name: string;
  insightId: string;
}

const PUT_ON_SHELF = "Put on shelf";

/**
 * "Put on shelf" for a saved chart. The button is also a drag handle: press
 * it to put the chart on the shelf, or drag it there.
 */
export function PutChartOnShelfButton({
  chart,
  className,
}: {
  /** Undefined while the chart is loading: the button waits, disabled. */
  chart: ShelfChart | undefined;
  className?: string;
}) {
  if (!chart) {
    return (
      <Button
        label={PUT_ON_SHELF}
        aria-label={PUT_ON_SHELF}
        variant="ghost"
        size="sm"
        disabled
        className={cn("h-6 w-6", className)}
      >
        <LayersIcon aria-hidden className="h-3.5 w-3.5" />
      </Button>
    );
  }
  return <CarryableChartButton chart={chart} className={className} />;
}

function CarryableChartButton({
  chart,
  className,
}: {
  chart: ShelfChart;
  className?: string;
}) {
  const ref: ShelfItemRef = {
    kind: "chart",
    id: chart.id,
    scope: chart.insightId,
    label: chart.name || "Untitled chart",
  };
  const { put } = useShelf();
  const { handleProps } = useCarryable(ref, "source");
  // Named for the chart, like the metric row's button: a report shows one of
  // these per tile, and "Put on shelf" alone does not say which.
  const name = `Put ${ref.label} on shelf`;
  return (
    <Button
      {...handleProps}
      label={name}
      aria-label={name}
      tooltip={PUT_ON_SHELF}
      variant="ghost"
      size="sm"
      className={cn("h-6 w-6 touch-none", className)}
      onClick={() => put(ref)}
    >
      <LayersIcon aria-hidden className="h-3.5 w-3.5" />
    </Button>
  );
}

/** The same button for a report tile, which knows only its chart's id. */
export function PutTileChartOnShelfButton({
  visualizationId,
  className,
}: {
  visualizationId: string;
  className?: string;
}) {
  const { data: visualizations } = queryStatus(
    useQuery({ query: api.app.listVisualizations, args: {} }),
  );
  const chart = visualizations?.find((entry) => entry.id === visualizationId);
  return <PutChartOnShelfButton chart={chart} className={className} />;
}
