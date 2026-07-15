import { Tooltip, cn } from "@wystack/ui";
import type { ReactNode } from "react";

export interface ControlTooltipProps {
  label: string;
  description?: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

/**
 * A consistent tooltip for compact controls and unfamiliar product language.
 * Keep the label aligned with the visible control and use the description to
 * explain the result of the action, rather than repeating its name.
 */
export function ControlTooltip({
  label,
  description,
  children,
  side = "bottom",
  className,
}: ControlTooltipProps) {
  return (
    <Tooltip
      side={side}
      className={cn("max-w-64 px-3 py-2 text-left", className)}
      content={
        <span className="block">
          <span className="block text-xs font-semibold leading-4">{label}</span>
          {description && (
            <span className="mt-0.5 block text-xs leading-4 text-neutral-fg-subtle">
              {description}
            </span>
          )}
        </span>
      }
    >
      {children}
    </Tooltip>
  );
}
