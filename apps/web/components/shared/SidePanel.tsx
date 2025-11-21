"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SidePanelProps {
  /** Optional header content (fixed at top, doesn't scroll) */
  header?: ReactNode;
  /** Scrollable main content */
  children: ReactNode;
  /** Optional footer content (fixed at bottom, doesn't scroll) */
  footer?: ReactNode;
  /** Optional className for customization */
  className?: string;
}

/**
 * SidePanel - Reusable side panel component with fixed header/footer and scrollable content
 *
 * Provides a consistent card-style panel with:
 * - Optional fixed header at the top
 * - Scrollable content area in the middle
 * - Optional fixed footer at the bottom
 *
 * @example
 * ```tsx
 * <SidePanel
 *   header={<h2>Controls</h2>}
 *   footer={<Button>Apply</Button>}
 * >
 *   <div>Scrollable content here</div>
 * </SidePanel>
 * ```
 */
export function SidePanel({
  header,
  children,
  footer,
  className,
}: SidePanelProps) {
  return (
    <div
      className={cn(
        "border-border/60 bg-card/70 supports-backdrop-filter:bg-card/60 flex h-full flex-col rounded-2xl border shadow-sm backdrop-blur",
        className,
      )}
    >
      {/* Fixed header */}
      {header && (
        <div className="border-border/60 shrink-0 border-b p-6">
          {header}
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6">{children}</div>

      {/* Fixed footer */}
      {footer && (
        <div className="border-border/60 shrink-0 border-t p-6">
          {footer}
        </div>
      )}
    </div>
  );
}
