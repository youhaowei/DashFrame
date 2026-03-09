"use client";

import { ButtonGroup, cn, Toggle, type ItemAction } from "@stdui/react";
import { useState } from "react";
import type { LucideIcon } from "../lib/icons";
import { GridIcon, ListIcon } from "../lib/icons";

export type { ItemAction } from "@stdui/react";

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
        "rounded-2xl border border-neutral-border/60 bg-neutral-bg/70 p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        {/* Header */}
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-neutral-fg">
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
              <p className="text-xs text-neutral-fg-subtle">{description}</p>
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
                  variant="outline"
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
                        "min-w-[220px] shrink-0 rounded-2xl border px-4 py-3 text-left transition focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:outline-none",
                        item.active
                          ? "border-primary/70 bg-palette-primary/5"
                          : "border-neutral-border/70 bg-neutral-bg/70",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {Icon && <Icon className="h-4 w-4 shrink-0" />}
                        <span className="text-sm font-medium text-neutral-fg">
                          {item.label}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {item.metadata && (
                          <span className="text-xs text-neutral-fg-subtle">
                            {item.metadata}
                          </span>
                        )}
                        {item.badge && (
                          <span className="rounded-full bg-neutral-bg-muted px-1 text-[10px] leading-4 font-semibold tracking-wide text-neutral-fg-subtle">
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
