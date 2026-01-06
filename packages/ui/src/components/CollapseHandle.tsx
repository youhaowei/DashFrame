import {
  ChevronsDownIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ChevronsUpIcon,
} from "../lib/icons";
import { cn } from "../lib/utils";

export interface CollapseHandleProps {
  direction: "left" | "right" | "up" | "down";
  isOpen: boolean;
  onClick: () => void;
  className?: string;
  ariaLabel?: string;
}

/**
 * CollapseHandle - Reusable collapse/expand handle button
 *
 * A semi-rounded button that attaches to the edge of a collapsible section.
 * Used for sidebars, panels, and sections that can be collapsed.
 *
 * @example
 * ```tsx
 * <CollapseHandle
 *   direction="down"
 *   isOpen={isOpen}
 *   onClick={() => setIsOpen(!isOpen)}
 * />
 * ```
 */
export function CollapseHandle({
  direction,
  isOpen,
  onClick,
  className,
  ariaLabel,
}: CollapseHandleProps) {
  const config = {
    left: {
      rounded: "rounded-l-xl",
      border: "border-r-0",
      openIcon: ChevronsLeftIcon,
      closedIcon: ChevronsRightIcon,
      size: "h-12 w-6",
    },
    right: {
      rounded: "rounded-r-xl",
      border: "border-l-0",
      openIcon: ChevronsRightIcon,
      closedIcon: ChevronsLeftIcon,
      size: "h-12 w-6",
    },
    up: {
      rounded: "rounded-t-xl",
      border: "border-b-0",
      openIcon: ChevronsUpIcon,
      closedIcon: ChevronsDownIcon,
      size: "h-6 w-12",
    },
    down: {
      rounded: "rounded-b-xl",
      border: "border-t-0",
      openIcon: ChevronsUpIcon,
      closedIcon: ChevronsDownIcon,
      size: "h-6 w-12",
    },
  }[direction];

  const Icon = isOpen ? config.openIcon : config.closedIcon;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center",
        config.size,
        config.rounded,
        "border border-border/60",
        config.border,
        "bg-card text-muted-foreground",
        "shadow-[0_2px_8px_rgba(0,0,0,0.08)]",
        "transition-all hover:bg-muted/50 hover:text-foreground hover:shadow-[0_3px_10px_rgba(0,0,0,0.12)]",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
      aria-label={ariaLabel || `${isOpen ? "Collapse" : "Expand"} section`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
