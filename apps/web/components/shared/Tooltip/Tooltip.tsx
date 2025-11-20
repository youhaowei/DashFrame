"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ComponentPropsWithoutRef, ReactElement } from "react";

interface SharedTooltipProps
    extends ComponentPropsWithoutRef<typeof TooltipContent> {
    content: React.ReactNode;
    children: ReactElement;
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

