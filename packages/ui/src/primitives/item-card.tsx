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

// ============================================================================
// Helper: Build wrapper props based on interaction mode
// ============================================================================

interface WrapperPropsParams {
  isDisabled: boolean;
  useButtonWrapper: boolean;
  onClick?: () => void;
  active: boolean;
}

function buildWrapperProps({
  isDisabled,
  useButtonWrapper,
  onClick,
  active,
}: WrapperPropsParams) {
  if (isDisabled) {
    return { "aria-disabled": true };
  }
  if (useButtonWrapper) {
    return {
      type: "button" as const,
      onClick,
      "aria-selected": active,
      role: "option",
    };
  }
  if (onClick) {
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

// ============================================================================
// Helper: Actions dropdown menu
// ============================================================================

function ActionsMenu({ actions }: { actions: ItemAction[] }) {
  return (
    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
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
  );
}

// ============================================================================
// Helper: Content section (header row + content + disabled reason)
// ============================================================================

interface ContentSectionProps {
  icon?: React.ReactNode;
  title?: string;
  subtitle?: string;
  content?: React.ReactNode;
  badge?: string;
  actions?: ItemAction[];
  active: boolean;
  isDisabled: boolean;
  isActiveAndEnabled: boolean;
  disabledReason: string | null;
  hasPreview: boolean;
}

function ContentSection({
  icon,
  title,
  subtitle,
  content,
  badge,
  actions,
  active,
  isDisabled,
  isActiveAndEnabled,
  disabledReason,
  hasPreview,
}: ContentSectionProps) {
  const hasActions = actions && actions.length > 0;

  return (
    <div className={cn(hasPreview ? "p-4" : "px-3.5 py-3")}>
      <div className="flex items-center gap-2">
        {icon && (
          <div
            className={cn(
              "shrink-0 rounded p-1.5 transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            {icon}
          </div>
        )}
        {title && (
          <p
            className={cn(
              "min-w-0 truncate text-sm font-medium transition-colors",
              isDisabled && "text-muted-foreground",
              isActiveAndEnabled && "text-primary",
              !isDisabled && !active && "text-foreground",
            )}
          >
            {title}
          </p>
        )}
        {subtitle && (
          <span className="text-muted-foreground shrink-0 text-xs">
            {subtitle}
          </span>
        )}
        {badge && (
          <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs">
            {badge}
          </span>
        )}
        <div className="flex-1" />
        {hasActions && !isDisabled && <ActionsMenu actions={actions} />}
      </div>
      {content && <div className="mt-2">{content}</div>}
      {disabledReason && (
        <p className="text-muted-foreground mt-1 text-xs">{disabledReason}</p>
      )}
    </div>
  );
}

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
  /**
   * Whether the card is disabled. When a string is provided,
   * it's used as the reason/explanation displayed to the user.
   * Disabled cards are grayed out and not clickable.
   */
  disabled?: boolean | string;
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
  disabled,
}: ItemCardProps) {
  const hasActions = actions && actions.length > 0;
  const isDisabled = Boolean(disabled);
  const disabledReason = typeof disabled === "string" ? disabled : null;
  const isClickable = Boolean(onClick) && !isDisabled;
  const isActiveAndEnabled = active && !isDisabled;

  // Determine wrapper element and props
  // When we have actions, use div with button role (nested buttons are invalid HTML)
  const useButtonWrapper = Boolean(onClick) && !hasActions && !isDisabled;
  const Wrapper = useButtonWrapper ? "button" : "div";
  const wrapperProps = buildWrapperProps({
    isDisabled,
    useButtonWrapper,
    onClick,
    active,
  });

  const contentSectionProps = {
    icon,
    title,
    subtitle,
    content,
    badge,
    actions,
    active,
    isDisabled,
    isActiveAndEnabled,
    disabledReason,
    hasPreview: Boolean(preview),
  };

  // Preview mode: vertical layout with preview at top
  if (preview) {
    return (
      <Wrapper
        {...wrapperProps}
        className={cn(
          "group w-full overflow-hidden rounded-lg border text-left transition-colors transition-shadow",
          isDisabled && "border-border/40 cursor-not-allowed opacity-50",
          isClickable && "hover:bg-accent/50 cursor-pointer",
          isActiveAndEnabled && "border-primary ring-primary ring-2",
          !isDisabled && !active && "border-border/60 hover:border-border",
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

        <ContentSection {...contentSectionProps} />
      </Wrapper>
    );
  }

  // Compact mode: horizontal layout (original behavior)
  // Uses subtle bg-card/50 to visually distinguish from Input fields
  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        "group w-full rounded-lg border text-left transition-colors transition-shadow",
        isDisabled && "border-border/40 cursor-not-allowed opacity-50",
        isClickable && "hover:bg-accent/50 cursor-pointer",
        isActiveAndEnabled && "border-primary bg-primary/5",
        !isDisabled &&
          !active &&
          "border-border/60 bg-card/50 hover:border-border hover:bg-accent/30",
        className,
      )}
    >
      <ContentSection {...contentSectionProps} />
    </Wrapper>
  );
}

// Backward compatibility alias
export const ClickableItemCard = ItemCard;
