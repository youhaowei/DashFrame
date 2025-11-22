"use client";

import { type ReactNode, forwardRef } from "react";
import { cn } from "../lib/utils";
import { Surface, type SurfaceElevation } from "../primitives/surface";

export interface PanelProps extends React.ComponentProps<"div"> {
  /**
   * The elevation variant for the panel surface.
   * Controls visual depth and shadow effects.
   *
   * @default "raised"
   */
  elevation?: SurfaceElevation;
  /** Optional header content (fixed at top, doesn't scroll) */
  header?: ReactNode;
  /** Scrollable main content */
  children: ReactNode;
  /** Optional footer content (fixed at bottom, doesn't scroll) */
  footer?: ReactNode;
}

/**
 * Panel - Reusable panel component with fixed header/footer and scrollable content
 *
 * Provides a consistent panel structure with standardized elevation using Surface:
 * - Optional fixed header at the top
 * - Scrollable content area in the middle
 * - Optional fixed footer at the bottom
 * - Customizable elevation (default: "raised")
 *
 * Use default "raised" elevation for standard panels. Only use "floating" for
 * panels that actually overlay other content (modals, popovers, etc.).
 *
 * @example
 * ```tsx
 * // Standard panel (default elevation)
 * <Panel
 *   header={<h2>Controls</h2>}
 *   footer={<Button>Apply</Button>}
 * >
 *   <div>Scrollable content here</div>
 * </Panel>
 *
 * // Panel with custom elevation
 * <Panel elevation="floating" header={<h2>Overlay Panel</h2>}>
 *   <div>Content that floats over other elements</div>
 * </Panel>
 *
 * // Panel with ref for ResizeObserver
 * const ref = useRef<HTMLDivElement>(null);
 * <Panel ref={ref} header={<h2>Resizable Panel</h2>}>
 *   <div>Content</div>
 * </Panel>
 * ```
 */
export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  { elevation = "raised", header, children, footer, className, ...props },
  ref,
) {
  return (
    <Surface
      ref={ref}
      elevation={elevation}
      className={cn("flex h-full flex-col", className)}
      {...props}
    >
      {/* Fixed header */}
      {header && (
        <div className="border-border/60 shrink-0 border-b">{header}</div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">{children}</div>

      {/* Fixed footer */}
      {footer && (
        <div className="border-border/60 shrink-0 border-t">{footer}</div>
      )}
    </Surface>
  );
});

export interface PanelSectionProps extends React.ComponentProps<"div"> {
  /** Optional section title */
  title?: string;
  /** Optional section description */
  description?: string;
  /** Section content */
  children: ReactNode;
}

/**
 * PanelSection - Section divider component for use within Panel or standalone
 *
 * Provides consistent section styling with optional title/description and
 * automatic border-b dividers between sections.
 *
 * @example
 * ```tsx
 * <Panel>
 *   <PanelSection title="General Settings" description="Basic configuration options">
 *     <div>Settings content</div>
 *   </PanelSection>
 *
 *   <PanelSection title="Advanced">
 *     <div>Advanced options</div>
 *   </PanelSection>
 * </Panel>
 * ```
 */
export function PanelSection({
  title,
  description,
  children,
  className,
  ...props
}: PanelSectionProps) {
  return (
    <div
      className={cn(
        "border-border/60 [&:not(:last-child)]:border-b",
        className,
      )}
      {...props}
    >
      {(title || description) && (
        <div className="mb-4">
          {title && (
            <h3 className="text-foreground text-base font-semibold">{title}</h3>
          )}
          {description && (
            <p className="text-muted-foreground mt-1 text-sm">{description}</p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
