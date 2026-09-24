import type { ShelfItem } from "./shelf-store";
import { WorkbenchChip } from "@dashframe/ui";
import { cn } from "@wystack/ui-react";
import {
  CalculatorIcon,
  ChartIcon,
  DragHandleVerticalIcon,
} from "@wystack/ui-react/icons";

const KIND_LABEL: Record<ShelfItem["kind"], string> = {
  metric: "Metric",
  chart: "Chart",
};

/** How a shelf item looks, on the shelf and under the pointer. */
export function ShelfChipView({
  item,
  lifted = false,
  onRemove,
}: {
  item: ShelfItem;
  lifted?: boolean;
  onRemove?: () => void;
}) {
  const Icon = item.kind === "metric" ? CalculatorIcon : ChartIcon;
  return (
    <WorkbenchChip
      className={cn(
        "max-w-60",
        lifted && "cursor-grabbing shadow-[var(--surface-shadow)]",
      )}
      dragHandle={<DragHandleVerticalIcon aria-hidden className="h-3 w-3" />}
      icon={<Icon aria-hidden />}
      title={item.label}
      description={KIND_LABEL[item.kind]}
      removeLabel={onRemove ? `Take ${item.label} off the shelf` : undefined}
      onRemove={onRemove}
    />
  );
}
