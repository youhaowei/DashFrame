import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

export interface ActionGroupProps {
  actions: ItemAction[];
  className?: string;
  compact?: boolean;
}

/**
 * ActionGroup - Renders a group of action buttons from definitions
 *
 * Universal component for rendering actions anywhere in the app.
 * Takes action definitions and renders them as styled buttons.
 *
 * @example
 * ```tsx
 * <ActionGroup
 *   actions={[
 *     { label: 'Save', onClick: handleSave, icon: Save },
 *     { label: 'Cancel', onClick: handleCancel, variant: 'outline' }
 *   ]}
 * />
 * ```
 */
export function ActionGroup({
  actions,
  className,
  compact = false,
}: ActionGroupProps) {
  if (actions.length === 0) return null;

  return (
    <div
      className={cn("flex shrink-0 flex-wrap items-center gap-2", className)}
    >
      {actions.map((action, index) => {
        const Icon = action.icon;
        const shouldShowLabel = !compact || !Icon;
        const buttonContent = action.children || (
          <>
            {Icon && (
              <Icon
                className={cn("h-4 w-4", shouldShowLabel && "mr-2")}
                aria-hidden
              />
            )}
            {shouldShowLabel ? (
              action.label
            ) : (
              <span className="sr-only">{action.label}</span>
            )}
          </>
        );
        const size = action.size || (compact ? "icon" : "sm");
        const variant = action.variant ?? "default";
        const baseClass = compact
          ? "h-9 w-9 min-w-0"
          : "h-9 min-w-[140px] px-4";
        const commonProps = {
          variant,
          size,
          className: cn(
            baseClass,
            "flex items-center justify-center",
            action.className,
            compact && "rounded-full",
          ),
          title: action.tooltip || (compact ? action.label : undefined),
          "aria-label": compact ? action.label : undefined,
          onClick: action.href ? undefined : action.onClick,
        };

        let content: ReactNode;
        if (action.href) {
          content = (
            <Link href={action.href} onClick={action.onClick}>
              {buttonContent}
            </Link>
          );
        } else if (action.asChild) {
          content = action.children;
        } else {
          content = buttonContent;
        }

        return (
          <Button
            key={index}
            asChild={Boolean(action.href) || action.asChild}
            {...commonProps}
          >
            {content}
          </Button>
        );
      })}
    </div>
  );
}
