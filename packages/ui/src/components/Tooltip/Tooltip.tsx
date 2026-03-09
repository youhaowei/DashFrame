"use client";

import {
  cn,
  TooltipPrimitive as Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@stdui/react";
import type { ReactElement } from "react";

interface SharedTooltipProps {
  content: React.ReactNode;
  children: ReactElement;
  className?: string;
}

export function SharedTooltip({
  content,
  children,
  className,
  ...props
}: SharedTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        className={cn(
          "rounded-full border border-neutral-border/50 bg-neutral-bg px-2 py-0.5 text-[10px] text-neutral-fg shadow-lg",
          className,
        )}
        {...props}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
