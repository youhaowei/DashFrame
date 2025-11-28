import { type ReactNode } from "react";
import {
  Tooltip as TooltipPrimitive,
  TooltipContent,
  TooltipTrigger,
} from "../primitives/tooltip";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

/**
 * Tooltip - Convenience wrapper for tooltips
 *
 * Simplifies tooltip usage by combining Tooltip, TooltipTrigger, and TooltipContent
 * into a single component. Requires TooltipProvider to be set up at the app root.
 *
 * @example
 * ```tsx
 * <Tooltip content="This is a tooltip">
 *   <Button>Hover me</Button>
 * </Tooltip>
 * ```
 */
export function Tooltip({ content, children, side, className }: TooltipProps) {
  return (
    <TooltipPrimitive>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className={className}>
        {content}
      </TooltipContent>
    </TooltipPrimitive>
  );
}
