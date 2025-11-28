import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "../lib/icons";
import { Button } from "../primitives/button";
import { cn } from "../lib/utils";

export interface ItemAction {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?:
    | "default"
    | "outline"
    | "destructive"
    | "secondary"
    | "ghost"
    | "link";
  icon?: LucideIcon;
  size?: "default" | "sm" | "lg" | "icon";
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
  tooltip?: string;
}

export interface ActionButtonProps extends ItemAction {
  /**
   * Compact mode - when true, shows only icon (if available) or label
   * Default sizing and styling changes based on compact mode
   */
  compact?: boolean;
}

/**
 * ActionButton - Renders a single action button from an action definition
 *
 * Standard button component for DashFrame. Extracted from ActionGroup to allow
 * standalone use of individual action buttons while maintaining consistency.
 *
 * This component handles:
 * - Icon + label rendering
 * - Link navigation (via href)
 * - Compact mode (icon-only when icon available)
 * - Tooltip support
 * - All button variants (default, outline, destructive, etc.)
 *
 * @example
 * ```tsx
 * // Standard button with icon and label
 * <ActionButton
 *   label="Save"
 *   onClick={handleSave}
 *   icon={Save}
 *   variant="default"
 * />
 *
 * // Compact icon-only button
 * <ActionButton
 *   label="Delete"
 *   onClick={handleDelete}
 *   icon={Trash2}
 *   variant="destructive"
 *   compact
 * />
 *
 * // Link button
 * <ActionButton
 *   label="View Details"
 *   href="/details"
 *   icon={ArrowRight}
 * />
 * ```
 */
export function ActionButton({
  label,
  onClick,
  href,
  variant = "default",
  icon: Icon,
  size,
  asChild,
  children,
  className,
  tooltip,
  compact = false,
}: ActionButtonProps) {
  const shouldShowLabel = !compact || !Icon;
  const buttonContent = children || (
    <>
      {Icon && (
        <Icon
          className={cn("h-4 w-4", shouldShowLabel && "mr-2")}
          aria-hidden
        />
      )}
      {shouldShowLabel ? label : <span className="sr-only">{label}</span>}
    </>
  );

  const buttonSize = size || (compact ? "icon" : "sm");
  const baseClass = compact ? "h-9 w-9 min-w-0" : "h-9 min-w-[140px] px-4";

  const commonProps = {
    variant,
    size: buttonSize,
    className: cn(
      baseClass,
      "flex items-center justify-center",
      className,
      compact && "rounded-full",
    ),
    title: tooltip || (compact ? label : undefined),
    "aria-label": compact ? label : undefined,
    onClick: href ? undefined : onClick,
  };

  let content: ReactNode;
  if (href) {
    content = (
      <Link href={href} onClick={onClick}>
        {buttonContent}
      </Link>
    );
  } else if (asChild) {
    content = children;
  } else {
    content = buttonContent;
  }

  return (
    <Button asChild={Boolean(href) || asChild} {...commonProps}>
      {content}
    </Button>
  );
}
