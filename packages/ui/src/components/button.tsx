import type { ReactNode } from "react";
import type { LucideIcon } from "../lib/icons";
import { Button as PrimitiveButton } from "../primitives/button";
import { cn } from "../lib/utils";

export interface ButtonProps {
  label: string;
  onClick?: () => void;
  variant?:
    | "default"
    | "outline"
    | "destructive"
    | "secondary"
    | "ghost"
    | "link";
  icon?: LucideIcon;
  size?: "default" | "sm" | "lg";
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
  tooltip?: string;
  /**
   * Icon-only mode - when true, shows only icon (if available) with sr-only label
   * Automatically uses icon size variants (icon, icon-sm, icon-lg) based on size prop
   */
  iconOnly?: boolean;
  /**
   * Whether the button is disabled
   */
  disabled?: boolean;
}

/**
 * ItemAction extends ButtonProps with grouping and nesting support for ActionGroup
 */
export interface ItemAction extends ButtonProps {
  /**
   * Optional href for link buttons - handled by ActionGroup component
   */
  href?: string;
  /**
   * Optional group identifier - actions with the same group value will be visually connected
   * as a button group (no gaps, connected borders). Actions without a group remain separate.
   * Only used in ActionGroup arrays.
   * @example
   * ```tsx
   * actions={[
   *   { label: 'Save', group: 'edit' },
   *   { label: 'Edit', group: 'edit' }, // visually connected to Save
   *   { label: 'Delete' } // separate button
   * ]}
   * ```
   */
  group?: string;
  /**
   * Optional nested actions - renders as a dropdown menu
   * When present, this action becomes a dropdown trigger
   * @example
   * ```tsx
   * actions={[
   *   { label: 'Save', onClick: handleSave },
   *   {
   *     label: 'More',
   *     icon: MoreHorizontal,
   *     actions: [
   *       { label: 'Archive', onClick: handleArchive },
   *       { label: 'Delete', onClick: handleDelete }
   *     ]
   *   }
   * ]}
   * ```
   */
  actions?: ItemAction[];
}

type ButtonSize = "default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-lg";

/**
 * Button - Enhanced button component with icon and icon-only mode support
 *
 * Standard button component for DashFrame. Provides a high-level API for rendering
 * buttons with icons, labels, and tooltips. Framework-agnostic - use asChild for links.
 *
 * Features:
 * - Icon + label rendering with automatic padding adjustment (via shadcn has-[>svg])
 * - Icon-only mode (shows icon with sr-only label)
 * - Tooltip support
 * - All shadcn button variants
 * - asChild prop for rendering as Link or other components (Radix Slot pattern)
 *
 * @example
 * ```tsx
 * // Standard button with icon and label
 * <Button
 *   label="Save"
 *   onClick={handleSave}
 *   icon={Save}
 *   variant="default"
 * />
 *
 * // Icon-only button
 * <Button
 *   label="Delete"
 *   onClick={handleDelete}
 *   icon={Trash2}
 *   variant="destructive"
 *   iconOnly
 * />
 *
 * // Link button (using asChild)
 * <Button label="View Details" icon={ArrowRight} asChild>
 *   <Link href="/details">View Details</Link>
 * </Button>
 * ```
 */
export function Button({
  label,
  onClick,
  variant = "default",
  icon: Icon,
  size,
  asChild,
  children,
  className,
  tooltip,
  iconOnly = false,
  disabled,
}: ButtonProps) {
  const shouldShowLabel = !iconOnly || !Icon;
  const buttonContent = children || (
    <>
      {Icon && <Icon aria-hidden />}
      {shouldShowLabel ? label : <span className="sr-only">{label}</span>}
    </>
  );

  const getButtonSize = (): ButtonSize => {
    // If iconOnly mode with an icon, use icon size variants
    if (iconOnly && Icon) {
      if (size === "sm") return "icon-sm";
      if (size === "lg") return "icon-lg";
      return "icon";
    }
    // Otherwise use standard size variants
    return size || "default";
  };

  const buttonSize = getButtonSize();

  return (
    <PrimitiveButton
      variant={variant}
      size={buttonSize}
      className={cn("flex items-center justify-center", className)}
      title={tooltip || (iconOnly ? label : undefined)}
      aria-label={iconOnly ? label : undefined}
      onClick={onClick}
      asChild={asChild}
      disabled={disabled}
    >
      {buttonContent}
    </PrimitiveButton>
  );
}
