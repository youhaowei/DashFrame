import { useState } from "react";
import { LayoutGrid, List } from "../lib/icons";
import type { LucideIcon } from "../lib/icons";
import { Tabs, TabsList, TabsTrigger } from "../primitives/tabs";
import { ActionGroup, type ItemAction } from "./ActionGroup";
import { Toggle } from "./Toggle";
import { cn } from "../lib/utils";

export type { ItemAction } from "./ActionGroup";

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
  className,
}: ItemSelectorProps) {
  const [viewStyle, setViewStyle] = useState<"compact" | "expanded">(
    "expanded",
  );
  const activeItem = items.find((item) => item.active);

  return (
    <div
      className={cn(
        "border-border/60 bg-card/70 rounded-2xl border p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        {/* Header */}
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h2 className="text-foreground text-base font-semibold">
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
                      icon: <List className="h-4 w-4" />,
                      tooltip: "Compact view",
                      ariaLabel: "Compact view",
                    },
                    {
                      value: "expanded",
                      icon: <LayoutGrid className="h-4 w-4" />,
                      tooltip: "Expanded view",
                      ariaLabel: "Expanded view",
                    },
                  ]}
                  onValueChange={(val) => setViewStyle(val)}
                />
              )}
            </div>
            {description && (
              <p className="text-muted-foreground text-xs">{description}</p>
            )}
          </div>
          {actions.length > 0 && (
            <ActionGroup
              actions={actions}
              compact={viewStyle === "compact"}
              className="w-full justify-end sm:w-auto"
            />
          )}
        </div>

        {/* Items */}
        {items.length > 0 && (
          <>
            {/* Compact view */}
            {viewStyle === "compact" && (
              <Tabs
                value={activeItem?.id}
                onValueChange={onItemSelect}
                className="min-w-0"
              >
                <div className="overflow-x-auto">
                  <TabsList className="border-border/60 bg-card/70 min-w-max rounded-2xl border px-1 py-1">
                    {items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <TabsTrigger
                          key={item.id}
                          value={item.id}
                          className={cn(
                            "text-muted-foreground min-w-[180px] justify-between gap-2 rounded-xl border border-transparent px-3 py-1.5 text-left text-sm font-medium transition",
                            "data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-primary",
                            "data-[state=active]:shadow-primary/20 data-[state=active]:shadow-sm",
                          )}
                        >
                          <span className="flex items-center gap-2 truncate">
                            {Icon && <Icon className="h-4 w-4 shrink-0" />}
                            <span className="truncate">{item.label}</span>
                          </span>
                          {item.badge && (
                            <span className="bg-muted text-muted-foreground rounded-full px-2 text-[11px] font-semibold tracking-wide">
                              {item.badge}
                            </span>
                          )}
                          {item.metadata && (
                            <span className="text-muted-foreground text-[11px]">
                              {item.metadata}
                            </span>
                          )}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </div>
              </Tabs>
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
                        "focus-visible:ring-ring min-w-[220px] shrink-0 rounded-2xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2",
                        item.active
                          ? "border-primary/70 bg-primary/5"
                          : "border-border/70 bg-card/70",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {Icon && <Icon className="h-4 w-4 shrink-0" />}
                        <span className="text-foreground text-sm font-medium">
                          {item.label}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {item.metadata && (
                          <span className="text-muted-foreground text-xs">
                            {item.metadata}
                          </span>
                        )}
                        {item.badge && (
                          <span className="bg-muted text-muted-foreground rounded-full px-2 text-[11px] font-semibold tracking-wide">
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
