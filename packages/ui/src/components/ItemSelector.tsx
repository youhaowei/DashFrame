"use client";

import { useState } from "react";
import type { LucideIcon } from "../lib/icons";
import { GridIcon, ListIcon } from "../lib/icons";
import { cn } from "../lib/utils";
import { ButtonGroup, type ItemAction } from "./ButtonGroup";
import { Toggle } from "./Toggle";

export type { ItemAction } from "./button";

export interface SelectableItem {
  id: string;
  label: string;
  active?: boolean;
  badge?: string;
  metadata?: string;
  icon?: LucideIcon | React.ComponentType<{ className?: string }>;
}

export interface ItemSelectorProps {
  title: string;
  description?: string;
  items: SelectableItem[];
  onItemSelect: (id: string) => void;
  actions: ItemAction[];
  defaultViewStyle?: "compact" | "expanded";
  className?: string;
}

/**
 * ItemSelector - Universal component for selecting items from a collection
 *
 * Items are always tabs functionally, with toggleable visual styles.
 * Defaults to expanded view, with toggle to switch to compact view.
 * Count is automatically derived from items.length.
 *
 * @example
 * ```tsx
 * <ItemSelector
 *   title="Visualizations"
 *   items={[
 *     { id: '1', label: 'Sales Chart', active: true, badge: 'Bar', metadata: '100 rows' }
 *   ]}
 *   onItemSelect={(id) => setActive(id)}
 *   actions={[
 *     { label: 'Manage Data', onClick: () => {}, variant: 'outline' },
 *     { label: 'New', onClick: () => {}, icon: Plus }
 *   ]}
 * />
 * ```
 */
export function ItemSelector({
  title,
  description,
  items,
  onItemSelect,
  actions,
  defaultViewStyle = "expanded",
  className,
}: ItemSelectorProps) {
  const [viewStyle, setViewStyle] = useState<"compact" | "expanded">(
    defaultViewStyle,
  );
  const activeItem = items.find((item) => item.active);

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        {/* Header */}
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-foreground">
                {title}
              </h2>
              {/* View style toggle inline */}
              {items.length > 0 && (
                <Toggle
                  variant="outline"
                  value={viewStyle}
                  options={[
                    {
                      value: "compact",
                      icon: <ListIcon className="h-4 w-4" />,
                      tooltip: "Compact view",
                      ariaLabel: "Compact view",
                    },
                    {
                      value: "expanded",
                      icon: <GridIcon className="h-4 w-4" />,
                      tooltip: "Expanded view",
                      ariaLabel: "Expanded view",
                    },
                  ]}
                  onValueChange={(val) => setViewStyle(val)}
                />
              )}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {actions.length > 0 && (
            <ButtonGroup
              actions={actions}
              className="w-full justify-end sm:w-auto"
            />
          )}
        </div>

        {/* Items */}
        {items.length > 0 && (
          <>
            {/* Compact view */}
            {viewStyle === "compact" && (
              <div className="overflow-x-auto">
                <Toggle
                  variant="default"
                  value={activeItem?.id || items[0]?.id || ""}
                  options={items.map((item) => ({
                    value: item.id,
                    label: item.label,
                    icon: item.icon ? (
                      <item.icon className="h-4 w-4" />
                    ) : undefined,
                    badge: item.badge || item.metadata,
                  }))}
                  onValueChange={onItemSelect}
                  className="min-w-max"
                />
              </div>
            )}

            {/* Expanded view */}
            {viewStyle === "expanded" && (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onItemSelect(item.id)}
                      aria-pressed={item.active}
                      className={cn(
                        "min-w-[220px] shrink-0 rounded-2xl border px-4 py-3 text-left transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        item.active
                          ? "border-primary/70 bg-primary/5"
                          : "border-border/70 bg-card/70",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {Icon && <Icon className="h-4 w-4 shrink-0" />}
                        <span className="text-sm font-medium text-foreground">
                          {item.label}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {item.metadata && (
                          <span className="text-xs text-muted-foreground">
                            {item.metadata}
                          </span>
                        )}
                        {item.badge && (
                          <span className="rounded-full bg-muted px-1 text-[10px] leading-4 font-semibold tracking-wide text-muted-foreground">
                            {item.badge}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
