import React, { type ReactNode } from "react";
import { cn } from "../lib/utils";
import { Tooltip } from "./Tooltip";

export interface ToggleOption<T extends string> {
  value: T;
  icon?: ReactNode;
  label?: string;
  badge?: string | number;
  tooltip?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export interface ToggleProps<T extends string> {
  value: T;
  options: ToggleOption<T>[];
  onValueChange: (value: T) => void;
  variant?: "default" | "outline";
  size?: "default" | "sm";
  className?: string;
}

/**
 * Toggle - Reusable segmented control/toggle component
 *
 * Supports two visual variants:
 * - default: Filled background style (Chart/Data Table/Both)
 * - outline: Compact outline style (Compact/Expanded view)
 *
 * Supports two sizes:
 * - default: Standard size with regular padding and text
 * - sm: Small size with reduced padding, smaller text, and smaller icons
 *
 * Both variants and sizes support icons, labels, badges, and disabled states.
 *
 * @example
 * ```tsx
 * // Default variant (filled background)
 * <Toggle
 *   variant="default"
 *   value={activeTab}
 *   options={[
 *     { value: "chart", icon: <BarChart3 />, label: "Chart" },
 *     { value: "table", icon: <TableIcon />, label: "Data Table", badge: 100 }
 *   ]}
 *   onValueChange={setActiveTab}
 * />
 *
 * // Outline variant (compact)
 * <Toggle
 *   variant="outline"
 *   value={viewStyle}
 *   options={[
 *     { value: "compact", icon: <List />, tooltip: "Compact view" },
 *     { value: "expanded", icon: <LayoutGrid />, tooltip: "Expanded view" }
 *   ]}
 *   onValueChange={setViewStyle}
 * />
 *
 * // Small size variant
 * <Toggle
 *   variant="outline"
 *   size="sm"
 *   value={viewStyle}
 *   options={[
 *     { value: "compact", icon: <List />, tooltip: "Compact view" },
 *     { value: "expanded", icon: <LayoutGrid />, tooltip: "Expanded view" }
 *   ]}
 *   onValueChange={setViewStyle}
 * />
 * ```
 */
export function Toggle<T extends string>({
  value,
  options,
  onValueChange,
  variant = "outline",
  size = "default",
  className,
}: ToggleProps<T>) {
  const containerClasses = {
    default: {
      default: "bg-muted rounded-2xl p-1",
      sm: "bg-muted rounded-xl p-0.5",
    },
    outline: {
      default: "bg-background/80 border border-border/60 rounded-full px-1.5 py-1",
      sm: "bg-background/80 border border-border/60 rounded-full px-1 py-0.5",
    },
  };

  const optionClasses = {
    default: {
      default: {
        base: "px-4 py-2 rounded-xl gap-2 text-sm font-medium transition-all",
        active: "bg-background text-foreground shadow-sm",
        inactive: "text-foreground hover:bg-background/60",
      },
      sm: {
        base: "px-2 py-1 rounded-lg gap-1 text-xs font-medium transition-all",
        active: "bg-background text-foreground shadow-sm",
        inactive: "text-foreground hover:bg-background/60",
      },
    },
    outline: {
      default: {
        base: "px-2 py-1 rounded-full gap-1 transition-colors",
        active: "bg-primary/10 text-primary",
        inactive: "text-muted-foreground hover:text-foreground",
      },
      sm: {
        base: "px-1.5 py-0.5 rounded-full gap-0.5 text-xs transition-colors",
        active: "bg-primary/10 text-primary",
        inactive: "text-muted-foreground hover:text-foreground",
      },
    },
  };

  const iconSizeClasses = {
    default: "",
    sm: "w-3 h-3",
  };

  return (
    <div
      role="tablist"
      className={cn(
        "flex items-center gap-1",
        containerClasses[variant][size],
        className,
      )}
    >
      {options.map((option) => {
        const isActive = value === option.value;
        const currentSizeClasses = optionClasses[variant][size];
        const button = (
          <button
            type="button"
            role="tab"
            onClick={() => !option.disabled && onValueChange(option.value)}
            disabled={option.disabled}
            aria-selected={isActive}
            aria-disabled={option.disabled}
            aria-label={option.ariaLabel || option.tooltip || option.label}
            className={cn(
              "flex items-center justify-center whitespace-nowrap disabled:pointer-events-none disabled:opacity-50",
              currentSizeClasses.base,
              isActive
                ? currentSizeClasses.active
                : currentSizeClasses.inactive,
            )}
          >
            {option.icon && (
              <span className={cn("shrink-0", iconSizeClasses[size])}>
                {option.icon}
              </span>
            )}
            {option.label && (
              <span className={size === "sm" ? "text-xs" : ""}>
                {option.label}
                {option.badge !== undefined && (
                  <span className={cn("ml-1", size === "sm" ? "text-xs" : "")}>
                    ({option.badge})
                  </span>
                )}
              </span>
            )}
          </button>
        );

        if (option.tooltip) {
          return (
            <Tooltip key={option.value} content={option.tooltip}>
              {button}
            </Tooltip>
          );
        }

        return <React.Fragment key={option.value}>{button}</React.Fragment>;
      })}
    </div>
  );
}

