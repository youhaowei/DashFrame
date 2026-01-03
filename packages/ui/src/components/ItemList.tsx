"use client";

import * as React from "react";
import { ScrollArea, ScrollBar } from "../primitives/scroll-area";
import { ItemCard, type ItemAction } from "../primitives/item-card";
import { cn } from "../lib/utils";
import type { LucideIcon } from "../lib/icons";

export interface ListItem {
  /**
   * Unique identifier for the item
   */
  id: string;
  /**
   * Primary title text
   */
  title: string;
  /**
   * Optional subtitle or metadata text (single line, truncated)
   */
  subtitle?: string;
  /**
   * Optional rich content section below subtitle.
   * Can contain any React content for flexible formatting.
   */
  content?: React.ReactNode;
  /**
   * Optional badge text to display
   */
  badge?: string;
  /**
   * Icon to display - can be a Lucide icon or custom React node
   */
  icon?: LucideIcon | React.ReactNode;
  /**
   * Whether this item is currently selected/active
   */
  active?: boolean;
  /**
   * Optional actions for this item (shown on hover)
   */
  actions?: ItemAction[];
  /**
   * Optional preview element to display above the card content
   */
  preview?: React.ReactNode;
  /**
   * Height of the preview section in pixels
   */
  previewHeight?: number;
  /**
   * Whether the item is disabled. When a string is provided,
   * it's used as the reason/explanation shown to the user.
   */
  disabled?: boolean | string;
}

export interface ItemListProps<T extends ListItem = ListItem> {
  /**
   * Array of items to display
   */
  items: T[];
  /**
   * Callback when an item is selected.
   * If not provided, items will not be clickable (no pointer cursor).
   */
  onSelect?: (id: string) => void;
  /**
   * Layout orientation
   * @default "vertical"
   */
  orientation?: "vertical" | "horizontal" | "grid";
  /**
   * Maximum size constraint (height for vertical, width for horizontal)
   * Can be a number (pixels) or CSS string value
   */
  maxSize?: number | string;
  /**
   * Gap between items in pixels
   * @default 8
   */
  gap?: number;
  /**
   * Fixed item width for horizontal layout (pixels)
   * @default 220
   */
  itemWidth?: number;
  /**
   * Number of columns for grid orientation.
   * When not specified, uses responsive defaults (1 on mobile, 2 on md, 3 on lg).
   */
  gridColumns?: number;
  /**
   * Additional CSS classes for the container
   */
  className?: string;
  /**
   * Message to display when items array is empty
   */
  emptyMessage?: string;
  /**
   * Icon to display in empty state
   */
  emptyIcon?: React.ReactNode;
  /**
   * Custom render function for items.
   * When provided, replaces the default ItemCard rendering.
   * Receives the item and a click handler.
   */
  renderItem?: (item: T, onClick: () => void) => React.ReactNode;
}

/**
 * ItemList - Data-driven scrollable list of items
 *
 * Renders a scrollable list of items using ItemCard internally.
 * Supports both vertical and horizontal orientations with configurable constraints.
 *
 * @example Vertical list with max height
 * ```tsx
 * <ItemList
 *   items={[
 *     { id: '1', title: 'Sales Data', subtitle: '150 rows', icon: Database },
 *     { id: '2', title: 'Users', subtitle: '42 rows', icon: Database, active: true }
 *   ]}
 *   onSelect={(id) => setSelectedId(id)}
 *   maxSize={300}
 * />
 * ```
 *
 * @example Horizontal scrolling gallery
 * ```tsx
 * <ItemList
 *   items={visualizations}
 *   onSelect={handleSelect}
 *   orientation="horizontal"
 *   itemWidth={240}
 *   gap={12}
 * />
 * ```
 *
 * @example With empty state
 * ```tsx
 * <ItemList
 *   items={[]}
 *   onSelect={() => {}}
 *   emptyMessage="No data sources connected"
 *   emptyIcon={<Database className="h-8 w-8" />}
 * />
 * ```
 *
 * @example With custom render function
 * ```tsx
 * <ItemList
 *   items={visualizations}
 *   onSelect={handleSelect}
 *   orientation="grid"
 *   renderItem={(item, onClick) => (
 *     <CustomCard key={item.id} data={item} onClick={onClick} />
 *   )}
 * />
 * ```
 */
export function ItemList<T extends ListItem>({
  items,
  onSelect,
  orientation = "vertical",
  maxSize,
  gap = 8,
  itemWidth = 220,
  gridColumns,
  className,
  emptyMessage = "No items",
  emptyIcon,
  renderItem,
}: ItemListProps<T>) {
  // Show empty state when no items
  if (items.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center p-8 text-center",
          className,
        )}
      >
        {emptyIcon && (
          <div className="mb-3 text-muted-foreground">{emptyIcon}</div>
        )}
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  // Convert maxSize to CSS value
  const maxSizeValue = typeof maxSize === "number" ? `${maxSize}px` : maxSize;

  // Render icon - handles both LucideIcon components and React nodes
  const renderIcon = (icon: ListItem["icon"]) => {
    if (!icon) return null;

    // If it's a component (LucideIcon), render it
    if (typeof icon === "function") {
      const Icon = icon as LucideIcon;
      return <Icon className="h-4 w-4" />;
    }

    // Otherwise it's already a React node
    return icon;
  };

  // Render a single item - uses custom renderItem if provided, otherwise default ItemCard
  const renderListItem = (item: T) => {
    // Only create onClick handler if onSelect is provided
    const onClick = onSelect ? () => onSelect(item.id) : undefined;

    if (renderItem) {
      return renderItem(item, onClick || (() => {}));
    }

    return (
      <ItemCard
        icon={renderIcon(item.icon)}
        title={item.title}
        subtitle={item.subtitle}
        content={item.content}
        badge={item.badge}
        active={item.active}
        actions={item.actions}
        preview={item.preview}
        previewHeight={item.previewHeight}
        disabled={item.disabled}
        onClick={onClick}
      />
    );
  };

  const itemElements = items.map((item) => (
    <div
      key={item.id}
      className={cn(orientation === "horizontal" && "shrink-0")}
      style={
        orientation === "horizontal" ? { width: `${itemWidth}px` } : undefined
      }
    >
      {renderListItem(item)}
    </div>
  ));

  // Vertical orientation
  if (orientation === "vertical") {
    return (
      <ScrollArea
        className={cn("w-full", className)}
        style={maxSizeValue ? { maxHeight: maxSizeValue } : undefined}
      >
        <div className="flex flex-col" style={{ gap: `${gap}px` }}>
          {itemElements}
        </div>
      </ScrollArea>
    );
  }

  // Grid orientation
  if (orientation === "grid") {
    // Use custom gridColumns if provided, otherwise use responsive defaults
    const gridStyle = gridColumns
      ? { gap: `${gap}px`, gridTemplateColumns: `repeat(${gridColumns}, 1fr)` }
      : { gap: `${gap}px` };

    return (
      <div
        className={cn(
          "grid",
          // Only apply responsive defaults when gridColumns is not specified
          !gridColumns && "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
          className,
        )}
        style={gridStyle}
      >
        {items.map((item) => (
          <div key={item.id}>{renderListItem(item)}</div>
        ))}
      </div>
    );
  }

  // Horizontal orientation
  return (
    <ScrollArea
      className={cn("w-full", className)}
      style={maxSizeValue ? { maxWidth: maxSizeValue } : undefined}
    >
      <div className="flex flex-row pb-3" style={{ gap: `${gap}px` }}>
        {itemElements}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
