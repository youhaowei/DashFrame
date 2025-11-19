"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CollapseHandle } from "./CollapseHandle";
import { cn } from "@/lib/utils";

export interface CollapsibleSectionProps {
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * CollapsibleSection - Wrapper component that adds collapsible functionality
 *
 * Pure wrapper that adds a chevron toggle button at the bottom to show/hide content.
 * The chevron button is positioned at the bottom center, similar to sidebar collapse patterns.
 *
 * @example
 * ```tsx
 * <CollapsibleSection defaultOpen={true}>
 *   <ItemSelector title="Visualizations" items={items} ... />
 * </CollapsibleSection>
 * ```
 */
export function CollapsibleSection({
  defaultOpen = true,
  children,
  className,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={cn("relative", className)}>
      <CollapsibleContent>
        {children}
      </CollapsibleContent>

      <div className="relative flex justify-center -mt-px">
        <CollapsibleTrigger asChild>
          <CollapseHandle
            direction="down"
            isOpen={isOpen}
            onClick={() => setIsOpen(!isOpen)}
          />
        </CollapsibleTrigger>
      </div>
    </Collapsible>
  );
}
