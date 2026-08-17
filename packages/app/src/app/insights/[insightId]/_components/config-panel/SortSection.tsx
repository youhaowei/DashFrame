import type { CombinedField } from "@/lib/insights/compute-combined-fields";
import { metricIdToColumnAlias } from "@dashframe/engine";
import type { InsightMetric, InsightSort } from "@dashframe/types";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wystack/ui-react";
import { CloseIcon, PlusIcon } from "@wystack/ui-react/icons";

interface SortSectionProps {
  sorts: InsightSort[];
  fields: CombinedField[];
  metrics: InsightMetric[];
  onChange: (sorts: InsightSort[]) => void;
}

export function SortSection({
  sorts,
  fields,
  metrics,
  onChange,
}: SortSectionProps) {
  const options = [
    ...fields.map((field) => ({
      value: field.columnName ?? field.name,
      label: field.displayName,
    })),
    ...metrics.map((metric) => ({
      value: metricIdToColumnAlias(metric.id),
      label: metric.name,
    })),
  ];

  const addSort = () => {
    const firstUnused = options.find(
      (option) => !sorts.some((sort) => sort.field === option.value),
    );
    if (firstUnused)
      onChange([...sorts, { field: firstUnused.value, direction: "asc" }]);
  };

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-neutral-fg">Sort</h3>
          <p className="text-xs text-neutral-fg-subtle">
            Set the default order of the result.
          </p>
        </div>
        <Button
          label="Add"
          icon={PlusIcon}
          variant="outline"
          size="sm"
          onClick={addSort}
          disabled={sorts.length >= options.length}
        />
      </div>

      {sorts.length === 0 ? (
        <p className="py-2 text-sm text-neutral-fg-subtle">
          No default sort configured.
        </p>
      ) : (
        <div className="space-y-2">
          {sorts.map((sort, index) => (
            <div
              key={`${sort.field}:${index}`}
              className="flex items-center gap-1.5 rounded-md border border-neutral-border/70 bg-neutral-bg px-2 py-2"
            >
              <Select
                value={sort.field}
                onValueChange={(field) => {
                  if (!field) return;
                  onChange(
                    sorts.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, field } : item,
                    ),
                  );
                }}
              >
                <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="text-xs"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={sort.direction}
                onValueChange={(direction) => {
                  if (!direction) return;
                  onChange(
                    sorts.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, direction: direction as "asc" | "desc" }
                        : item,
                    ),
                  );
                }}
              >
                <SelectTrigger className="h-8 w-20 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc" className="text-xs">
                    Asc
                  </SelectItem>
                  <SelectItem value="desc" className="text-xs">
                    Desc
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                label="Remove sort"
                icon={CloseIcon}
                variant="ghost"
                size="sm"
                onClick={() => onChange(sorts.filter((_, i) => i !== index))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
