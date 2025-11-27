import * as React from "react";
import { cn } from "../lib/utils";

export interface SectionListProps {
  /**
   * Section title displayed above the content
   */
  title: string;
  /**
   * Content to display (usually a list of items)
   */
  children: React.ReactNode;
  /**
   * Optional message to show when there are no items
   */
  emptyMessage?: string;
  /**
   * Additional CSS classes for the container
   */
  className?: string;
  /**
   * Additional CSS classes for the title
   */
  titleClassName?: string;
  /**
   * Additional CSS classes for the content grid
   */
  contentClassName?: string;
}

/**
 * A layout component that displays a section header followed by a grid of content items.
 *
 * Used throughout the app for consistent section styling (e.g., "Existing Data Tables", "Add New Source").
 *
 * @example
 * ```tsx
 * <SectionList title="Existing Data Tables">
 *   {tables.map((table) => (
 *     <ClickableItemCard
 *       key={table.id}
 *       icon={<Database />}
 *       title={table.name}
 *       onClick={() => handleSelect(table.id)}
 *     />
 *   ))}
 * </SectionList>
 * ```
 */
export function SectionList({
  title,
  children,
  emptyMessage,
  className,
  titleClassName,
  contentClassName,
}: SectionListProps) {
  return (
    <section className={cn("space-y-3", className)}>
      <h4
        className={cn(
          "text-sm font-medium text-muted-foreground",
          titleClassName
        )}
      >
        {title}
      </h4>
      <div className={cn("grid gap-3", contentClassName)}>
        {children}
      </div>
      {emptyMessage && !React.Children.count(children) && (
        <p className="text-muted-foreground text-sm">{emptyMessage}</p>
      )}
    </section>
  );
}
