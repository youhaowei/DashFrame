import React, { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./Tooltip";

export interface ToggleOption<T extends string> {
  value: T;
  icon?: ReactNode;
  label?: string;
  tooltip?: string;
  ariaLabel?: string;
}

export interface ToggleProps<T extends string> {
  value: T;
  options: ToggleOption<T>[];
  onValueChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md" | "lg";
}

/**
 * Toggle - Reusable pill-style toggle component
 *
 * Displays options as buttons in a pill-shaped container with clear active state indication.
 * Supports icons, labels, and tooltips for each option.
 *
 * @example
 * ```tsx
 * <Toggle
 *   value={viewStyle}
 *   options={[
 *     { value: "compact", icon: <List />, tooltip: "Compact view", ariaLabel: "Compact view" },
 *     { value: "expanded", icon: <LayoutGrid />, tooltip: "Expanded view", ariaLabel: "Expanded view" }
 *   ]}
 *   onValueChange={setViewStyle}
 * />
 * ```
 */
export function Toggle<T extends string>({
  value,
  options,
  onValueChange,
  className,
  size = "md",
}: ToggleProps<T>) {
  const sizeClasses = {
    sm: "h-5 w-5 text-xs",
    md: "h-6 w-6",
    lg: "h-7 w-7",
  };

  const iconSizeClasses = {
    sm: "h-3 w-3",
    md: "h-3.5 w-3.5",
    lg: "h-4 w-4",
  };

  return (
    <div
      className={cn(
        "border-border/60 bg-background/80 flex items-center gap-1 rounded-full border px-1.5 py-1",
        className,
      )}
    >
      {options.map((option) => {
        const isActive = value === option.value;
        const button = (
          <button
            type="button"
            onClick={() => onValueChange(option.value)}
            className={cn(
              "flex items-center justify-center rounded-full transition-colors",
              sizeClasses[size],
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-label={option.ariaLabel || option.tooltip || option.label}
            aria-pressed={isActive}
          >
            {option.icon && (
              <span className={iconSizeClasses[size]}>{option.icon}</span>
            )}
            {option.label && !option.icon && (
              <span className="text-[10px] px-1">{option.label}</span>
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

