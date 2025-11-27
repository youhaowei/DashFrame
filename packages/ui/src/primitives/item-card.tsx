import * as React from "react";
import { cn } from "../lib/utils";
import { ActionGroup, type ItemAction } from "../components/ActionGroup";

export type { ItemAction };

export interface ItemCardProps {
  /**
   * Icon element to display on the left
   */
  icon: React.ReactNode;
  /**
   * Primary title text
   */
  title: string;
  /**
   * Optional subtitle or metadata text
   */
  subtitle?: string;
  /**
   * Optional badge text to display
   */
  badge?: string;
  /**
   * Optional click handler - when provided, card becomes clickable
   */
  onClick?: () => void;
  /**
   * Whether the card is in active/selected state
   */
  active?: boolean;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Optional preview/thumbnail element to display above card content.
   * When provided, renders in a container above the icon+title+subtitle layout.
   */
  preview?: React.ReactNode;
  /**
   * Height of preview section in pixels (only applies when preview is provided)
   * @default 200
   */
  previewHeight?: number;
  /**
   * Optional list of actions to display in a dropdown menu.
   * Uses ActionGroup component internally.
   */
  actions?: ItemAction[];
}

/**
 * ItemCard - Versatile card component for displaying items.
 *
 * Supports multiple modes:
 * - **Compact** (default): Icon on left with title/subtitle
 * - **With preview**: Shows preview/thumbnail above content
 * - **With actions**: Optional action buttons (visible on hover)
 * - **Interactive**: Optional onClick handler
 *
 * @example Compact mode
 * ```tsx
 * <ItemCard
 *   icon={<Database className="h-4 w-4" />}
 *   title="Sales Data"
 *   subtitle="150 rows × 8 columns"
 *   onClick={() => handleSelect('sales-id')}
 *   active={selectedId === 'sales-id'}
 * />
 * ```
 *
 * @example With preview
 * ```tsx
 * <ItemCard
 *   preview={<VegaChart spec={chartSpec} />}
 *   icon={<BarChart3 className="h-8 w-8" />}
 *   title="Revenue by Region"
 *   subtitle="Created Jan 15"
 *   badge="Bar Chart"
 *   onClick={() => router.push('/viz/123')}
 * />
 * ```
 *
 * @example With actions
 * ```tsx
 * <ItemCard
 *   icon={<File className="h-4 w-4" />}
 *   title="Document"
 *   actions={[
 *     { label: "Edit", icon: Edit, onClick: handleEdit },
 *     { label: "Delete", icon: Trash2, onClick: handleDelete, variant: "destructive" }
 *   ]}
 * />
 * ```
 */
export function ItemCard({
  icon,
  title,
  subtitle,
  badge,
  onClick,
  active = false,
  className,
  preview,
  previewHeight = 200,
  actions,
}: ItemCardProps) {
  const hasActions = actions && actions.length > 0;

  // Determine the wrapper element
  // IMPORTANT: When we have actions, we must NOT use a <button> wrapper
  // because ActionGroup renders buttons, and nested buttons are invalid HTML.
  // Instead, we use a <div> with role="button" for accessibility.
  const useButtonWrapper = onClick && !hasActions;
  const Wrapper = useButtonWrapper ? "button" : "div";
  const wrapperProps = useButtonWrapper
    ? {
        type: "button" as const,
        onClick,
        "aria-selected": active,
        role: "option",
      }
    : onClick
      ? {
          // When we have actions, use div with button role for accessibility
          role: "button" as const,
          tabIndex: 0,
          "aria-selected": active,
          onClick,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick();
            }
          },
        }
      : {};

  // Content section (icon + title + subtitle + badge + actions)
  const contentSection = (
    <div className={cn("flex items-start gap-3", preview ? "p-4" : "p-3")}>
      {/* Icon with background */}
      <div
        className={cn(
          "mt-0.5 rounded p-1.5 transition-all flex-shrink-0",
          active
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground"
        )}
      >
        {icon}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              "truncate text-sm font-medium transition-all",
              active ? "text-primary" : "text-foreground"
            )}
          >
            {title}
          </p>
          {badge && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {badge}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-muted-foreground mt-1 text-xs truncate">
            {subtitle}
          </p>
        )}
      </div>

      {/* Actions (hover-visible) */}
      {hasActions && (
        <div
          className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <ActionGroup actions={actions} compact />
        </div>
      )}
    </div>
  );

  // Preview mode: vertical layout with preview at top
  if (preview) {
    return (
      <Wrapper
        {...wrapperProps}
        className={cn(
          "group w-full rounded-xl border overflow-hidden text-left transition-all",
          onClick && "cursor-pointer hover:shadow-md",
          active
            ? "border-primary ring-2 ring-primary"
            : "border-border/60 hover:border-border",
          className
        )}
      >
        {/* Preview Section */}
        <div
          className="w-full bg-card border-b"
          style={{ height: `${previewHeight}px` }}
        >
          {preview}
        </div>

        {/* Content Section */}
        {contentSection}
      </Wrapper>
    );
  }

  // Compact mode: horizontal layout (original behavior)
  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        "group w-full rounded-xl border text-left transition-all",
        onClick && "cursor-pointer hover:shadow-md",
        active
          ? "border-primary bg-primary/5"
          : "border-border/60 hover:border-border",
        className
      )}
    >
      {contentSection}
    </Wrapper>
  );
}

// Backward compatibility alias
export const ClickableItemCard = ItemCard;
