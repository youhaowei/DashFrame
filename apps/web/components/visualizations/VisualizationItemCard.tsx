"use client";

import * as React from "react";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  PrimitiveButton,
  type ItemAction,
} from "@dashframe/ui";
import type { Visualization } from "@dashframe/types";
import { VisualizationPreview } from "./VisualizationPreview";
import {
  BarChart3,
  CircleDot,
  LineChart,
  TableIcon,
  MoreOptions,
} from "@dashframe/ui/icons";

interface VisualizationItemCardProps {
  /** The visualization to display */
  visualization: Visualization;
  /** Click handler - navigates to visualization detail */
  onClick?: () => void;
  /** Whether this card is selected/active */
  active?: boolean;
  /** Height of the preview section in pixels */
  previewHeight?: number;
  /** Additional CSS classes */
  className?: string;
  /** Optional list of actions to display in a dropdown menu */
  actions?: ItemAction[];
}

/**
 * Get fallback icon for visualization type (shown when preview can't render)
 */
function getVizFallbackIcon(type: string) {
  switch (type) {
    case "bar":
      return <BarChart3 className="text-muted-foreground/40 h-10 w-10" />;
    case "line":
    case "area":
      return <LineChart className="text-muted-foreground/40 h-10 w-10" />;
    case "point":
    case "scatter":
      return <CircleDot className="text-muted-foreground/40 h-10 w-10" />;
    case "table":
    default:
      return <TableIcon className="text-muted-foreground/40 h-10 w-10" />;
  }
}

/**
 * VisualizationItemCard - Card component for displaying visualization previews
 *
 * A specialized card that shows:
 * - Live chart preview (via VisualizationPreview)
 * - Title and creation date below the preview
 *
 * Designed for use in grids without icons or badges - the chart preview
 * itself serves as the visual identifier.
 *
 * @example
 * ```tsx
 * <VisualizationItemCard
 *   visualization={viz}
 *   onClick={() => router.push(`/visualizations/${viz.id}`)}
 *   previewHeight={140}
 * />
 * ```
 */
export function VisualizationItemCard({
  visualization,
  onClick,
  active = false,
  previewHeight = 140,
  className,
  actions,
}: VisualizationItemCardProps) {
  const vizType = visualization.visualizationType ?? "table";
  const createdDate = new Date(visualization.createdAt).toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    },
  );
  const hasActions = actions && actions.length > 0;

  const handleClick = () => {
    onClick?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "group w-full overflow-hidden rounded-lg border text-left transition-all",
        onClick && "hover:bg-accent/50 cursor-pointer",
        active
          ? "border-primary ring-primary ring-2"
          : "border-border/60 hover:border-border",
        className,
      )}
    >
      {/* Preview Section */}
      <div
        className="bg-muted/30 w-full overflow-hidden"
        style={{ height: `${previewHeight}px` }}
      >
        <VisualizationPreview
          visualization={visualization}
          height={previewHeight}
          fallback={getVizFallbackIcon(vizType)}
        />
      </div>

      {/* Content Section - title, date, and actions */}
      <div className="p-4">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              "min-w-0 flex-1 truncate text-sm font-medium transition-all",
              active ? "text-primary" : "text-foreground",
            )}
          >
            {visualization.name}
          </p>

          {/* Actions dropdown menu */}
          {hasActions && (
            <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <PrimitiveButton
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <MoreOptions className="h-4 w-4" />
                    <span className="sr-only">Actions</span>
                  </PrimitiveButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {actions.map((action, index) => (
                    <DropdownMenuItem
                      key={index}
                      onClick={action.onClick}
                      className={cn(
                        action.variant === "destructive" &&
                          "text-destructive focus:text-destructive",
                      )}
                    >
                      {action.icon && <action.icon className="h-4 w-4" />}
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        <p className="text-muted-foreground mt-1 truncate text-xs">
          Created {createdDate}
        </p>
      </div>
    </div>
  );
}
