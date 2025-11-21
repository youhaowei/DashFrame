"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "../../primitives/tooltip";
import { cn } from "../../lib/utils";
import type { ComponentPropsWithoutRef, ReactElement } from "react";

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
                    "bg-background text-foreground border border-border/50 rounded-full px-2 py-0.5 text-[10px] shadow-lg",
                    className,
                )}
                {...props}
            >
                {content}
            </TooltipContent>
        </Tooltip>
    );
}

