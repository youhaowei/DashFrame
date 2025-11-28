import * as React from "react";

import { cn } from "../lib/utils";

export type SurfaceElevation = "plain" | "raised" | "floating" | "inset";

export interface SurfaceProps extends React.ComponentProps<"div"> {
  /**
   * The elevation variant determining the surface's visual depth and shadow.
   *
   * - `plain`: Minimal flat surface with border only, no shadow
   * - `raised`: Standard elevated surface with subtle shadow (default)
   * - `floating`: Prominent elevation with backdrop blur and stronger shadow
   * - `inset`: Sunken appearance with inset shadow for recessed areas
   *
   * @default "raised"
   */
  elevation?: SurfaceElevation;
  /**
   * Adds hover interaction states for clickable or interactive surfaces.
   *
   * @default false
   */
  interactive?: boolean;
}

/**
 * Surface - Primitive component for standardized elevation and visual depth.
 *
 * Surface provides a foundational system for creating UI layers with consistent
 * elevation effects. Use it for backgrounds, containers, and any element that
 * needs standardized depth or visual hierarchy.
 *
 * @example
 * ```tsx
 * // Standard card surface
 * <Surface elevation="raised" className="p-6">
 *   <h2>Content</h2>
 * </Surface>
 *
 * // Elevated panel with backdrop blur
 * <Surface elevation="floating" className="p-8">
 *   <nav>Navigation</nav>
 * </Surface>
 *
 * // Sunken empty state area
 * <Surface elevation="inset" className="p-8 text-center">
 *   <p>No items found</p>
 * </Surface>
 *
 * // Interactive clickable surface
 * <Surface elevation="raised" interactive className="p-4 cursor-pointer">
 *   <button>Click me</button>
 * </Surface>
 * ```
 */
function Surface({
  elevation = "raised",
  interactive = false,
  className,
  ...props
}: SurfaceProps) {
  return (
    <div
      data-slot="surface"
      className={cn(
        // Base styles
        "rounded-2xl border transition-colors",
        // Elevation variants
        {
          // Plain: Minimal flat surface, border only
          "border-border bg-background": elevation === "plain",
          // Raised: Standard card appearance
          "border-border/60 bg-card/80 shadow-sm": elevation === "raised",
          // Floating: Elevated panel with glassmorphism
          "border-border/60 bg-card/70 supports-backdrop-filter:bg-card/60 shadow-lg backdrop-blur":
            elevation === "floating",
          // Inset: Sunken surface with inset shadow
          "border-border/70 bg-background/40 shadow-inner shadow-black/5":
            elevation === "inset",
        },
        // Interactive states
        interactive && "hover:border-border hover:bg-accent/50 cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

export { Surface };
