import * as React from "react";
import { cn } from "../lib/utils";
import { Surface, type SurfaceProps } from "../primitives/surface";
import { ButtonGroup, type ItemAction } from "./ButtonGroup";
import { Skeleton } from "../primitives/skeleton";

export interface SectionProps extends Omit<SurfaceProps, "children"> {
  /** Section title */
  title: string;
  /** Optional description or metadata */
  description?: string;
  /** Optional actions shown on the right of header */
  actions?: ItemAction[];
  /** Section content */
  children: React.ReactNode;
  /** Show loading skeleton instead of content */
  isLoading?: boolean;
  /** Height of loading skeleton (default: 200px) */
  loadingHeight?: number;
}

/**
 * Section - Standardized section with title, description, and content
 *
 * Provides consistent layout for sections with:
 * - Title (text-sm font-semibold)
 * - Optional description (text-xs muted)
 * - Optional action buttons using ActionGroup (right-aligned)
 * - Built on Surface component for consistent elevation
 *
 * @example
 * ```tsx
 * <Section
 *   title="Data sources"
 *   description="Tables used in this insight"
 *   actions={[
 *     { label: 'Add join', onClick: handleAddJoin, icon: Plus }
 *   ]}
 * >
 *   <ItemList items={items} />
 * </Section>
 * ```
 */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  elevation = "raised",
  isLoading = false,
  loadingHeight = 200,
  ...surfaceProps
}: SectionProps) {
  return (
    <Surface
      elevation={elevation}
      className={cn("space-y-3 p-6", className)}
      {...surfaceProps}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-foreground text-sm font-semibold">{title}</p>
          {description && (
            <p className="text-muted-foreground text-xs">{description}</p>
          )}
        </div>
        {actions && actions.length > 0 && <ButtonGroup actions={actions} />}
      </div>

      {/* Content or Loading Skeleton */}
      {isLoading ? (
        <Skeleton
          className="w-full rounded-xl"
          style={{ height: loadingHeight }}
        />
      ) : (
        children
      )}
    </Surface>
  );
}
