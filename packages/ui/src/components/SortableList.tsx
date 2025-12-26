"use client";

import * as React from "react";
import { useCallback } from "react";
import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ScrollArea, ScrollBar } from "../primitives/scroll-area";
import { ItemCard, type ItemAction } from "../primitives/item-card";
import { cn } from "../lib/utils";
import { DragHandleVerticalIcon, type LucideIcon } from "../lib/icons";
import type { ListItem, ItemListProps } from "./ItemList";

/**
 * Base sortable item requires only an id.
 * When using renderItem, only id is needed.
 * When using default ItemCard rendering, title and other ListItem props are used.
 */
export interface SortableListItem {
  /** Unique identifier for the item (required for sorting) */
  id: string;
  /** Primary title text (required when using default ItemCard rendering) */
  title?: string;
  /** Optional subtitle or metadata text */
  subtitle?: string;
  /** Optional badge text to display */
  badge?: string;
  /** Icon to display - can be a Lucide icon or custom React node */
  icon?: LucideIcon | React.ReactNode;
  /** Whether this item is currently selected/active */
  active?: boolean;
  /** Optional actions for this item (shown on hover) */
  actions?: ItemAction[];
  /** Optional preview element to display above the card content */
  preview?: React.ReactNode;
  /** Height of the preview section in pixels */
  previewHeight?: number;
}

export interface SortableListProps<
  T extends SortableListItem = SortableListItem,
> extends Omit<ItemListProps, "items" | "onSelect" | "renderItem"> {
  /** Array of items to display (must have unique `id` property) */
  items: T[];
  /** Callback when items are reordered via drag-and-drop */
  onReorder: (items: T[]) => void;
  /** Optional callback when an item is selected (clicked) */
  onSelect?: (id: string) => void;
  /**
   * Optional custom render function for item content.
   * When provided, renders custom content instead of ItemCard.
   * The drag handle is automatically added.
   */
  renderItem?: (item: T, index: number) => React.ReactNode;
  /** Additional CSS classes for each sortable item wrapper */
  itemClassName?: string;
}

/**
 * SortableList - Drag-and-drop sortable list built on top of ItemList
 *
 * Wraps ItemList with @dnd-kit for accessible, performant drag-and-drop sorting.
 * Supports all orientations: vertical, horizontal, and grid.
 * Each item gets a drag handle that appears on the left side.
 *
 * @example Vertical sortable list
 * ```tsx
 * <SortableList
 *   items={fields}
 *   onReorder={setFields}
 *   onSelect={(id) => console.log('Selected:', id)}
 * />
 * ```
 *
 * @example Horizontal sortable gallery
 * ```tsx
 * <SortableList
 *   items={visualizations}
 *   onReorder={handleReorder}
 *   orientation="horizontal"
 *   itemWidth={240}
 * />
 * ```
 *
 * @example Grid sortable layout
 * ```tsx
 * <SortableList
 *   items={dashboardCards}
 *   onReorder={handleReorder}
 *   orientation="grid"
 * />
 * ```
 *
 * @example Custom render function for inline items
 * ```tsx
 * <SortableList
 *   items={fields}
 *   onReorder={setFields}
 *   renderItem={(field) => (
 *     <div className="flex items-center gap-2 flex-1">
 *       <Hash className="h-4 w-4" />
 *       <span>{field.name}</span>
 *       <Badge>{field.type}</Badge>
 *     </div>
 *   )}
 * />
 * ```
 */

/**
 * Helper function to render DragOverlay content.
 * Extracted to avoid nested ternary operations in the main component.
 */
function renderDragOverlayContent<T extends SortableListItem>(
  activeItem: T | null | undefined,
  items: T[],
  renderItem: ((item: T, index: number) => React.ReactNode) | undefined,
  renderIcon: (icon: ListItem["icon"]) => React.ReactNode,
  itemClassName?: string,
): React.ReactNode {
  if (!activeItem) {
    return null;
  }

  if (renderItem) {
    return (
      <div
        className={cn(
          "bg-card flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 shadow-lg",
          itemClassName,
        )}
      >
        <DragHandleVerticalIcon className="text-muted-foreground h-4 w-4 shrink-0" />
        {renderItem(activeItem, items.indexOf(activeItem))}
      </div>
    );
  }

  return (
    <div className="pl-6">
      <ItemCard
        icon={renderIcon(activeItem.icon) || <div className="h-4 w-4" />}
        title={activeItem.title}
        subtitle={activeItem.subtitle}
        badge={activeItem.badge}
        active={activeItem.active}
        className={cn("shadow-lg", itemClassName)}
      />
    </div>
  );
}

export function SortableList<T extends SortableListItem>({
  items,
  onReorder,
  onSelect,
  orientation = "vertical",
  maxSize,
  gap = 8,
  itemWidth = 220,
  className,
  emptyMessage = "No items",
  emptyIcon,
  renderItem,
  itemClassName,
}: SortableListProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over || active.id === over.id) return;

      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        onReorder(arrayMove(items, oldIndex, newIndex));
      }
    },
    [items, onReorder],
  );

  const activeItem = activeId
    ? items.find((item) => item.id === activeId)
    : null;

  // Get sorting strategy based on orientation
  // Using if/else instead of nested ternary for lint compliance
  let sortingStrategy;
  if (orientation === "horizontal") {
    sortingStrategy = horizontalListSortingStrategy;
  } else if (orientation === "grid") {
    sortingStrategy = rectSortingStrategy;
  } else {
    sortingStrategy = verticalListSortingStrategy;
  }

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
          <div className="text-muted-foreground mb-3">{emptyIcon}</div>
        )}
        <p className="text-muted-foreground text-sm">{emptyMessage}</p>
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((item) => item.id)}
        strategy={sortingStrategy}
      >
        {orientation === "vertical" && maxSizeValue && (
          <ScrollArea
            className={cn("w-full", className)}
            style={{ maxHeight: maxSizeValue }}
          >
            <div
              className="flex min-w-0 max-w-full flex-col"
              style={{ gap: `${gap}px` }}
            >
              {items.map((item, index) => (
                <SortableItem
                  key={item.id}
                  item={item}
                  index={index}
                  renderIcon={renderIcon}
                  renderItem={renderItem}
                  onSelect={onSelect}
                  itemClassName={itemClassName}
                />
              ))}
            </div>
          </ScrollArea>
        )}

        {orientation === "vertical" && !maxSizeValue && (
          <div
            className={cn("flex min-w-0 flex-col", className)}
            style={{ gap: `${gap}px` }}
          >
            {items.map((item, index) => (
              <SortableItem
                key={item.id}
                item={item}
                index={index}
                renderIcon={renderIcon}
                renderItem={renderItem}
                onSelect={onSelect}
                itemClassName={itemClassName}
              />
            ))}
          </div>
        )}

        {orientation === "horizontal" && (
          <ScrollArea
            className={cn("w-full", className)}
            style={maxSizeValue ? { maxWidth: maxSizeValue } : undefined}
          >
            <div className="flex flex-row pb-3" style={{ gap: `${gap}px` }}>
              {items.map((item, index) => (
                <SortableItem
                  key={item.id}
                  item={item}
                  index={index}
                  renderIcon={renderIcon}
                  renderItem={renderItem}
                  onSelect={onSelect}
                  style={{ width: `${itemWidth}px` }}
                  className="shrink-0"
                  itemClassName={itemClassName}
                />
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}

        {orientation === "grid" && (
          <div
            className={cn(
              "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
              className,
            )}
            style={{ gap: `${gap}px` }}
          >
            {items.map((item, index) => (
              <SortableItem
                key={item.id}
                item={item}
                index={index}
                renderIcon={renderIcon}
                renderItem={renderItem}
                onSelect={onSelect}
                itemClassName={itemClassName}
              />
            ))}
          </div>
        )}
      </SortableContext>

      {/* DragOverlay renders in a portal to escape overflow boundaries */}
      <DragOverlay>
        {renderDragOverlayContent(
          activeItem,
          items,
          renderItem,
          renderIcon,
          itemClassName,
        )}
      </DragOverlay>
    </DndContext>
  );
}

interface SortableItemProps<T extends SortableListItem> {
  item: T;
  index: number;
  renderIcon: (icon: ListItem["icon"]) => React.ReactNode;
  renderItem?: (item: T, index: number) => React.ReactNode;
  onSelect?: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
  itemClassName?: string;
}

function SortableItem<T extends SortableListItem>({
  item,
  index,
  renderIcon,
  renderItem,
  onSelect,
  className,
  style,
  itemClassName,
}: SortableItemProps<T>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...style,
  };

  // Custom renderItem mode - simpler inline layout with drag handle
  // Note: min-w-0 is essential for truncate to work in flex children
  if (renderItem) {
    return (
      <div
        ref={setNodeRef}
        style={sortableStyle}
        className={cn(
          "bg-card flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5",
          isDragging && "opacity-50",
          className,
          itemClassName,
        )}
      >
        {/* Drag handle */}
        <button
          className="text-muted-foreground hover:text-foreground shrink-0 cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <DragHandleVerticalIcon className="h-4 w-4" />
        </button>

        {/* Custom content */}
        {renderItem(item, index)}
      </div>
    );
  }

  // Default ItemCard mode
  return (
    <div
      ref={setNodeRef}
      style={sortableStyle}
      className={cn("relative", isDragging && "opacity-50", className)}
    >
      {/* Drag handle overlay - positioned on left side */}
      <div
        className={cn(
          "absolute left-0 top-0 z-10 flex h-full cursor-grab items-center pl-2 pr-1 active:cursor-grabbing",
          "text-muted-foreground hover:text-foreground",
          "rounded-l-xl transition-colors",
          isDragging && "cursor-grabbing",
        )}
        {...attributes}
        {...listeners}
      >
        <DragHandleVerticalIcon className="h-4 w-4" />
      </div>

      {/* ItemCard with padding for drag handle */}
      <div className="pl-6">
        <ItemCard
          icon={renderIcon(item.icon) || <div className="h-4 w-4" />}
          title={item.title}
          subtitle={item.subtitle}
          badge={item.badge}
          active={item.active}
          actions={item.actions}
          preview={item.preview}
          previewHeight={item.previewHeight}
          onClick={onSelect ? () => onSelect(item.id) : undefined}
          className={itemClassName}
        />
      </div>
    </div>
  );
}
