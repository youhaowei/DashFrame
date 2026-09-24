import { metricIdToColumnAlias } from "@dashframe/engine";
import type { ColumnAnalysis, InsightMetric } from "@dashframe/types";
import { metricEncoding } from "@dashframe/types";
import { cn } from "@wystack/ui-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useShelfDropTarget, type ShelfVerdict } from "./ShelfDnd";
import { getShelfMeasureImporter } from "./shelf-importers";
import type { ShelfItem } from "./shelf-store";

interface ShelfAxisDropZoneProps {
  axis: "x" | "y";
  insightId: string;
  /** The chart's own table; a saved metric only imports from it. */
  tableId: string | undefined;
  metrics: readonly InsightMetric[];
  columnAnalysis: readonly ColumnAnalysis[];
  /** The same write the axis picker makes. */
  onSet: (encoding: string) => void;
  children: ReactNode;
}

function sameDefinition(
  metric: InsightMetric,
  item: Extract<ShelfItem, { kind: "metric" }>,
): boolean {
  return (
    metric.name === item.label &&
    metric.aggregation === item.ref.aggregation &&
    (metric.columnName ?? null) === (item.ref.columnName ?? null)
  );
}

function dropState(verdict: ShelfVerdict | null, isOver: boolean) {
  if (verdict === null) return undefined;
  if (verdict !== true) return "refuses";
  return isOver ? "over" : "accepts";
}

/**
 * SPIKE: an axis well that takes a metric from the shelf. The chart's own copy
 * of the metric is used when it has one; otherwise the saved metric is
 * imported first and the axis is set once the import has echoed and the
 * metric's column has been analysed, as the picker would require.
 */
export function ShelfAxisDropZone({
  axis,
  insightId,
  tableId,
  metrics,
  columnAnalysis,
  onSet,
  children,
}: ShelfAxisDropZoneProps) {
  // The ref drives the one pending write; the state only shows progress.
  const pendingRef = useRef<string | null>(null);
  const [pendingMetricId, setPendingMetricId] = useState<string | null>(null);
  const isReady = (metricId: string) => {
    const alias = metricIdToColumnAlias(metricId);
    return (
      metrics.some((metric) => metric.id === metricId) &&
      columnAnalysis.some((column) => column.columnName === alias)
    );
  };
  const adding = pendingMetricId !== null && !isReady(pendingMetricId);

  useEffect(() => {
    const metricId = pendingRef.current;
    if (!metricId) return;
    const alias = metricIdToColumnAlias(metricId);
    const ready =
      metrics.some((metric) => metric.id === metricId) &&
      columnAnalysis.some((column) => column.columnName === alias);
    if (!ready) return;
    pendingRef.current = null;
    onSet(metricEncoding(metricId));
  }, [columnAnalysis, metrics, onSet, pendingMetricId]);

  const accepts = (item: ShelfItem): ShelfVerdict => {
    if (item.kind !== "metric") return "A chart can't go on an axis";
    if (!tableId || item.ref.tableId !== tableId)
      return "This metric is from another table";
    return true;
  };

  const onDrop = (item: ShelfItem) => {
    if (item.kind !== "metric") return;
    const own = metrics.find((metric) => sameDefinition(metric, item));
    if (own) {
      onSet(metricEncoding(own.id));
      return;
    }
    const importer = getShelfMeasureImporter(insightId);
    if (!importer) {
      toast.error("Open the chart's settings to add this metric");
      return;
    }
    importer(item.ref.metricId)
      .then((metricId) => {
        pendingRef.current = metricId;
        setPendingMetricId(metricId);
      })
      .catch(() => toast.error(`Couldn't add ${item.label} to the chart`));
  };

  const { setNodeRef, isOver, verdict } = useShelfDropTarget(
    `shelf-axis:${axis}`,
    accepts,
    onDrop,
  );

  return (
    <div
      ref={setNodeRef}
      data-shelf-drop={axis}
      data-shelf-state={dropState(verdict, isOver)}
      className={cn(
        "rounded-lg transition-[opacity,outline-color] duration-150 motion-reduce:transition-none",
        verdict === true &&
          "outline-1 outline-offset-2 outline-dashed outline-neutral-border",
        verdict === true && isOver && "outline-palette-primary",
        typeof verdict === "string" && "opacity-40",
      )}
    >
      {children}
      {typeof verdict === "string" && (
        <p className="mt-1 text-[11px] leading-4 text-neutral-fg-subtle">
          {verdict}
        </p>
      )}
      {adding && (
        <p className="mt-1 text-[11px] leading-4 text-neutral-fg-subtle">
          Adding the metric…
        </p>
      )}
    </div>
  );
}
