"use client";

import { cn, Tooltip } from "@wystack/ui";
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
}: SharedTooltipProps) {
  return (
    <Tooltip
      content={content}
      className={cn(
        "rounded-full border border-neutral-border/50 bg-neutral-bg px-2 py-0.5 text-[10px] text-neutral-fg shadow-lg",
        className,
      )}
    >
      {children}
    </Tooltip>
  );
}
