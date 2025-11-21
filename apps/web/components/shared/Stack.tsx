import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface StackProps {
  /** Child elements to stack */
  children: ReactNode;
  /** Stack direction - vertical (column) or horizontal (row) */
  direction?: "vertical" | "horizontal";
  /** Spacing between items - maps to gap-* classes */
  spacing?: "none" | "xs" | "sm" | "md" | "lg" | "xl";
  /** Alignment along cross axis */
  align?: "start" | "center" | "end" | "stretch";
  /** Justification along main axis */
  justify?: "start" | "center" | "end" | "between" | "around";
  /** Whether to wrap items */
  wrap?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** HTML element to render as */
  as?: "div" | "section" | "article" | "main" | "aside" | "nav";
}

const spacingMap = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-8",
} as const;

const alignMap = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
} as const;

const justifyMap = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
} as const;

/**
 * Stack - Flexible layout component for vertical or horizontal stacking
 *
 * Replaces repetitive `<div className="flex flex-col gap-*">` patterns with a
 * semantic, type-safe component. Provides consistent spacing and alignment.
 *
 * @example
 * ```tsx
 * // Vertical stack with standard spacing
 * <Stack direction="vertical" spacing="md">
 *   <ComponentA />
 *   <ComponentB />
 * </Stack>
 *
 * // Horizontal stack with center alignment
 * <Stack direction="horizontal" spacing="sm" align="center">
 *   <Icon className="h-4 w-4" />
 *   <span>Label</span>
 * </Stack>
 *
 * // Wrapping horizontal stack
 * <Stack direction="horizontal" spacing="sm" wrap>
 *   {tags.map(tag => <Badge key={tag}>{tag}</Badge>)}
 * </Stack>
 * ```
 */
export function Stack({
  children,
  direction = "vertical",
  spacing = "md",
  align,
  justify,
  wrap = false,
  className,
  as: Component = "div",
}: StackProps) {
  return (
    <Component
      className={cn(
        "flex",
        direction === "vertical" ? "flex-col" : "flex-row",
        spacingMap[spacing],
        align && alignMap[align],
        justify && justifyMap[justify],
        wrap && "flex-wrap",
        className,
      )}
    >
      {children}
    </Component>
  );
}
