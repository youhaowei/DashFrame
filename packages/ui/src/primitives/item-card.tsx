import * as React from "react";
import { cn } from "../lib/utils";
import { type ItemAction } from "../components/ButtonGroup";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Button as PrimitiveButton } from "./button";
import { MoreOptions } from "../lib/icons";

export type { ItemAction };

export interface ItemCardProps {
  /**
   * Icon element to display on the left.
   * Optional when preview is provided.
   */
  icon?: React.ReactNode;
  /**
   * Primary title text. Optional when using card for non-text content.
   */
  title?: string;
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
  content,
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

  // Build wrapper props based on interaction mode
  function getWrapperProps() {
    if (useButtonWrapper) {
      return {
        type: "button" as const,
        onClick,
        "aria-selected": active,
        role: "option",
      };
    }
    if (onClick) {
      // When we have actions, use div with button role for accessibility
      return {
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
      };
    }
    return {};
  }
  const wrapperProps = getWrapperProps();

  // Content section (icon + title + subtitle + badge + actions)
  // Compact mode uses p-3.5 for better visual separation from Input fields
  // When content is present, actions move below; otherwise they stay on the right
  const contentSection = (
    <div className={cn(preview ? "p-4" : "px-3.5 py-3")}>
      <div className="flex items-start gap-3">
        {/* Icon with background (optional) */}
        {icon && (
          <div
            className={cn(
              "mt-0.5 shrink-0 rounded p-1.5 transition-all",
              active
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            {icon}
          </div>
        )}

        {/* Content */}
        <div className="min-w-0 flex-1">
          {(title || badge) && (
            <div className="flex items-center gap-2">
              {title && (
                <p
                  className={cn(
                    "truncate text-sm font-medium transition-all",
                    active ? "text-primary" : "text-foreground",
                  )}
                >
                  {title}
                </p>
              )}
              {badge && (
                <span className="text-muted-foreground shrink-0 text-xs">
                  {badge}
                </span>
              )}
            </div>
          )}
          {subtitle && (
            <p className="text-muted-foreground mt-1 truncate text-xs">
              {subtitle}
            </p>
          )}
          {content && <div className="mt-2">{content}</div>}
        </div>

        {/* Actions dropdown menu - always visible */}
        {hasActions && (
          <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <PrimitiveButton
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <MoreOptions className="h-4 w-4" />
                  <span className="sr-only">Actions</span>
                </PrimitiveButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {actions.map((action, index) => (
                  <DropdownMenuItem
                    key={index}
                    onClick={action.onClick}
                    className={cn(
                      action.variant === "destructive" &&
                        "text-destructive focus:text-destructive",
                    )}
                  >
                    {action.icon && <action.icon className="h-4 w-4" />}
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );

  // Preview mode: vertical layout with preview at top
  if (preview) {
    return (
      <Wrapper
        {...wrapperProps}
        className={cn(
          "group w-full overflow-hidden rounded-lg border text-left transition-all",
          onClick && "hover:bg-accent/50 cursor-pointer",
          active
            ? "border-primary ring-primary ring-2"
            : "border-border/60 hover:border-border",
          className,
        )}
      >
        {/* Preview Section */}
        <div
          className="bg-card w-full border-b"
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
  // Uses subtle bg-card/50 to visually distinguish from Input fields
  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        "group w-full rounded-lg border text-left transition-all",
        onClick && "hover:bg-accent/50 cursor-pointer",
        active
          ? "border-primary bg-primary/5"
          : "border-border/60 bg-card/50 hover:border-border hover:bg-accent/30",
        className,
      )}
    >
      {contentSection}
    </Wrapper>
  );
}

// Backward compatibility alias
export const ClickableItemCard = ItemCard;
