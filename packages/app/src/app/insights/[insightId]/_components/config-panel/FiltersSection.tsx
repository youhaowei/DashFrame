import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import type {
  InsightFilter,
  InsightFilterBetweenValue,
} from "@dashframe/types";
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
  ChevronRightIcon,
  CloseIcon,
  EditIcon,
  PlusIcon,
  SettingsIcon,
} from "@wystack/ui-icons";
import { useCallback, useMemo, useState } from "react";

// ============================================================================
// Types
// ============================================================================

/** Extended sortable item with filter data + stable id */
interface FilterSortableItem extends SortableListItem {
  filter: InsightFilter;
}

export interface FilterWithId extends InsightFilter {
  /** Stable client-only id for sortable list keying */
  _id: string;
}

interface FiltersSectionProps {
  filters: FilterWithId[];
  combinedFields: CombinedField[];
  onReorder: (filters: FilterWithId[]) => void;
  onRemove: (filterId: string) => void;
  onEditClick: (filter: FilterWithId) => void;
  onAddClick: () => void;
  defaultOpen?: boolean;
}

// ============================================================================
// Operator label helpers
// ============================================================================

const OPERATOR_LABELS: Record<InsightFilter["operator"], string> = {
  eq: "=",
  ne: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "contains",
  in: "in",
  between: "between",
};

function formatFilterValue(filter: InsightFilter): string {
  if (filter.operator === "between") {
    const v = filter.value as InsightFilterBetweenValue | undefined;
    if (v && typeof v === "object" && "low" in v && "high" in v) {
      return `${String(v.low ?? "")} … ${String(v.high ?? "")}`;
    }
    return "…";
  }
  if (Array.isArray(filter.value)) {
    return `(${(filter.value as unknown[]).join(", ")})`;
  }
  return String(filter.value ?? "");
}

// ============================================================================
// FiltersSection
// ============================================================================

/**
 * FiltersSection — Collapsible section for managing insight filter predicates.
 *
 * Mirrors MetricsSection exactly: same Collapsible/SortableList/inline-edit
 * pattern. Filters have no visualization encoding dependency so deletion is
 * immediate — no cascade confirmation dialog.
 */
export function FiltersSection({
  filters,
  combinedFields,
  onReorder,
  onRemove,
  onEditClick,
  onAddClick,
  defaultOpen = true,
}: FiltersSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const sortableItems: FilterSortableItem[] = filters.map((filter) => ({
    id: filter._id,
    filter,
  }));

  const handleReorder = useCallback(
    (items: FilterSortableItem[]) => {
      onReorder(items.map((item) => item.filter as FilterWithId));
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
                <SettingsIcon className="h-4 w-4 text-neutral-fg-subtle" />
                <span className="text-sm leading-none font-medium">
                  Filters
                </span>
                <Badge
                  variant="soft"
                  className="h-5 px-1.5 text-xs leading-none tabular-nums"
                >
                  {filters.length}
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
                renderItem={(item) => (
                  <FilterItemContent
                    filter={item.filter as FilterWithId}
                    combinedFields={combinedFields}
                    onRemove={() => onRemove(item.id)}
                    onEditClick={() => onEditClick(item.filter as FilterWithId)}
                  />
                )}
              />
            ) : (
              <p className="py-2 text-sm text-neutral-fg-subtle">
                No filters configured.
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ============================================================================
// FilterItemContent
// ============================================================================

interface FilterItemContentProps {
  filter: FilterWithId;
  combinedFields: CombinedField[];
  onRemove: () => void;
  onEditClick: () => void;
}

function FilterItemContent({
  filter,
  combinedFields,
  onRemove,
  onEditClick,
}: FilterItemContentProps) {
  // Resolve display name for the field — stale ref shows fieldName with warning
  const fieldDisplay = useMemo(() => {
    const found = combinedFields.find(
      (f) => (f.columnName ?? f.name) === filter.field,
    );
    if (!found) {
      // Stale field reference — show gracefully, don't crash
      return { name: filter.field, stale: true };
    }
    return { name: found.displayName, stale: false };
  }, [combinedFields, filter.field]);

  const operatorLabel = OPERATOR_LABELS[filter.operator] ?? filter.operator;
  const valueLabel = formatFilterValue(filter);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span
        className={cn(
          "min-w-0 shrink-0 max-w-[6rem] truncate text-sm",
          fieldDisplay.stale
            ? "text-palette-danger/80 line-through"
            : "text-neutral-fg",
        )}
        title={
          fieldDisplay.stale
            ? `Field "${filter.field}" no longer exists`
            : fieldDisplay.name
        }
      >
        {fieldDisplay.name}
      </span>
      <span className="shrink-0 text-xs font-medium text-neutral-fg-subtle">
        {operatorLabel}
      </span>
      <span
        className="min-w-0 flex-1 cursor-pointer truncate text-sm text-neutral-fg hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          onEditClick();
        }}
        title={`${fieldDisplay.name} ${operatorLabel} ${valueLabel} (click to edit)`}
      >
        {valueLabel}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onEditClick();
        }}
        className="shrink-0 rounded-full p-0.5 text-neutral-fg-subtle hover:bg-neutral-bg-muted hover:text-neutral-fg"
        aria-label={`Edit filter on ${fieldDisplay.name}`}
      >
        <EditIcon className="h-3 w-3" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="shrink-0 rounded-full p-0.5 text-neutral-fg-subtle hover:bg-neutral-bg-muted hover:text-neutral-fg"
        aria-label={`Remove filter on ${fieldDisplay.name}`}
      >
        <CloseIcon className="h-3 w-3" />
      </button>
    </div>
  );
}
