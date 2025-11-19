import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { LayoutGrid, List } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionGroup, type ItemAction } from "./ActionGroup";
import { cn } from "@/lib/utils";

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
  const [viewStyle, setViewStyle] = useState<"compact" | "expanded">("expanded");
  const activeItem = items.find((item) => item.active);

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card/70 px-4 py-2 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        {/* Header */}
        <div className="flex flex-col gap-3 min-w-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-foreground">
                {title}
              </h2>
              {/* View style toggle inline */}
              {items.length > 0 && (
                <div className="flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-1.5 py-1">
                  <button
                    type="button"
                    onClick={() => setViewStyle("compact")}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full transition-colors",
                      viewStyle === "compact"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    aria-label="Compact view"
                  >
                    <List className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewStyle("expanded")}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full transition-colors",
                      viewStyle === "expanded"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    aria-label="Expanded view"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
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
                  <TabsList className="min-w-max rounded-2xl border border-border/50 bg-card/60 px-1 py-1">
                    {items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <TabsTrigger
                          key={item.id}
                          value={item.id}
                          className={cn(
                            "min-w-[180px] justify-between gap-2 rounded-xl border border-transparent px-3 py-1.5 text-left text-sm font-medium text-muted-foreground transition",
                            "data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-primary",
                            "data-[state=active]:shadow-sm data-[state=active]:shadow-primary/20",
                          )}
                        >
                          <span className="flex items-center gap-2 truncate">
                            {Icon && <Icon className="h-4 w-4 shrink-0" />}
                            <span className="truncate">{item.label}</span>
                          </span>
                          {item.badge && (
                            <span className="rounded-full bg-muted px-2 text-[11px] font-semibold tracking-wide text-muted-foreground">
                              {item.badge}
                            </span>
                          )}
                          {item.metadata && (
                            <span className="text-[11px] text-muted-foreground">
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
                      className={cn(
                        "min-w-[220px] shrink-0 rounded-2xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        item.active
                          ? "border-primary/70 bg-primary/5"
                          : "border-border/70 bg-card/70"
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
                          <span className="rounded-full bg-muted px-2 text-[11px] font-semibold tracking-wide text-muted-foreground">
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
