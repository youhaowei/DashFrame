import type { InsightMetric } from "@dashframe/types";
import { SortableList, type SortableListItem } from "@dashframe/ui";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
} from "@wystack/ui";
import {
  CalculatorIcon,
  ChevronRightIcon,
  CloseIcon,
  EditIcon,
  PlusIcon,
} from "@wystack/ui-icons";
import { useCallback, useState } from "react";

/** Extended sortable item with metric data */
interface MetricSortableItem extends SortableListItem {
  metric: InsightMetric;
}

interface MetricsSectionProps {
  metrics: InsightMetric[];
  onReorder: (metrics: InsightMetric[]) => void;
  onRemove: (metricId: string) => void;
  onEditClick: (metric: InsightMetric) => void;
  onAddClick: () => void;
  defaultOpen?: boolean;
}

/**
 * MetricsSection - Collapsible section for managing insight metrics (aggregations)
 *
 * Shows a sortable list of metrics with drag-and-drop reordering.
 * Each metric displays name and aggregation type.
 */
export function MetricsSection({
  metrics,
  onReorder,
  onRemove,
  onEditClick,
  onAddClick,
  defaultOpen = true,
}: MetricsSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // Convert InsightMetric to sortable item format
  const sortableItems: MetricSortableItem[] = metrics.map((metric) => ({
    id: metric.id,
    metric,
  }));

  // Handle reorder - convert back to metrics
  const handleReorder = useCallback(
    (items: MetricSortableItem[]) => {
      onReorder(items.map((item) => item.metric));
    },
    [onReorder],
  );

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <CollapsibleTrigger
            render={
              <button className="-ml-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-neutral-bg-emphasis/50">
                <ChevronRightIcon
                  className={cn(
                    "h-4 w-4 text-neutral-fg-subtle transition-transform",
                    isOpen && "rotate-90",
                  )}
                />
                <CalculatorIcon className="h-4 w-4 text-neutral-fg-subtle" />
                <span className="text-sm leading-none font-medium">
                  Metrics
                </span>
                <Badge
                  variant="soft"
                  className="h-5 px-1.5 text-xs leading-none tabular-nums"
                >
                  {metrics.length}
                </Badge>
              </button>
            }
          />
          <Button
            label="Add"
            icon={PlusIcon}
            variant="ghost"
            size="sm"
            onClick={onAddClick}
          />
        </div>
        <CollapsibleContent>
          <div className="overflow-hidden px-4 pb-4">
            {sortableItems.length > 0 ? (
              <SortableList
                items={sortableItems}
                onReorder={handleReorder}
                gap={6}
                itemClassName="bg-palette-primary/5 border-palette-primary/20"
                renderItem={(item) => (
                  <MetricItemContent
                    metric={item.metric}
                    onRemove={() => onRemove(item.id)}
                    onEditClick={() => onEditClick(item.metric)}
                  />
                )}
              />
            ) : (
              <p className="py-2 text-sm text-neutral-fg-subtle">
                No metrics configured.
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface MetricItemContentProps {
  metric: InsightMetric;
  onRemove: () => void;
  onEditClick: () => void;
}

function MetricItemContent({
  metric,
  onRemove,
  onEditClick,
}: MetricItemContentProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <CalculatorIcon className="h-3 w-3 shrink-0 text-palette-primary" />
      <span
        className="min-w-0 flex-1 cursor-pointer truncate text-sm text-palette-primary hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          onEditClick();
        }}
        title={`${metric.name} (click to edit)`}
      >
        {metric.name}
      </span>
      <span className="shrink-0 text-xs text-palette-primary/60">
        {metric.aggregation}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onEditClick();
        }}
        className="shrink-0 rounded-full p-0.5 text-palette-primary/60 hover:bg-palette-primary/10 hover:text-palette-primary"
        aria-label={`Edit ${metric.name}`}
      >
        <EditIcon className="h-3 w-3" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="shrink-0 rounded-full p-0.5 text-palette-primary/60 hover:bg-palette-primary/10 hover:text-palette-primary"
        aria-label={`Remove ${metric.name}`}
      >
        <CloseIcon className="h-3 w-3" />
      </button>
    </div>
  );
}
