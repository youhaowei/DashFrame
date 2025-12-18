"use client";

import { useState, useCallback } from "react";
import {
  Button,
  Badge,
  SortableList,
  type SortableListItem,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
} from "@dashframe/ui";
import { Calculator, Plus, ChevronRight, X } from "@dashframe/ui/icons";
import type { InsightMetric } from "@dashframe/types";

/** Extended sortable item with metric data */
interface MetricSortableItem extends SortableListItem {
  metric: InsightMetric;
}

interface MetricsSectionProps {
  metrics: InsightMetric[];
  onReorder: (metrics: InsightMetric[]) => void;
  onRemove: (metricId: string) => void;
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
          <CollapsibleTrigger asChild>
            <button className="hover:bg-accent/50 -ml-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors">
              <ChevronRight
                className={cn(
                  "text-muted-foreground h-4 w-4 transition-transform",
                  isOpen && "rotate-90",
                )}
              />
              <Calculator className="text-muted-foreground h-4 w-4" />
              <span className="text-sm font-medium leading-none">Metrics</span>
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-xs tabular-nums leading-none"
              >
                {metrics.length}
              </Badge>
            </button>
          </CollapsibleTrigger>
          <Button
            label="Add"
            icon={Plus}
            variant="ghost"
            size="sm"
            onClick={onAddClick}
          />
        </div>
        <CollapsibleContent>
          <div className="px-4 pb-4">
            {sortableItems.length > 0 ? (
              <SortableList
                items={sortableItems}
                onReorder={handleReorder}
                gap={6}
                itemClassName="bg-primary/5 border-primary/20"
                renderItem={(item) => (
                  <MetricItemContent
                    metric={item.metric}
                    onRemove={() => onRemove(item.id)}
                  />
                )}
              />
            ) : (
              <p className="text-muted-foreground py-2 text-sm">
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
}

function MetricItemContent({ metric, onRemove }: MetricItemContentProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Calculator className="text-primary h-3 w-3 shrink-0" />
      <span className="text-primary min-w-0 flex-1 truncate text-sm">
        {metric.name}
      </span>
      <span className="text-primary/60 shrink-0 text-xs">
        {metric.aggregation}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="text-primary/60 hover:bg-primary/10 hover:text-primary shrink-0 rounded-full p-0.5"
        aria-label={`Remove ${metric.name}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
