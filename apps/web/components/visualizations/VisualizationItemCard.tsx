import type { Visualization } from "@dashframe/types";
import { ChartIcon, DataPointIcon, MoreIcon, TableIcon } from "@stdui/icons";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  type ItemCardAction,
} from "@stdui/react";
import * as React from "react";
import { VisualizationPreview } from "./VisualizationPreview";

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
  actions?: ItemCardAction[];
}

/**
 * Get fallback icon for visualization type (shown when preview can't render)
 */
function getVizFallbackIcon(type: string) {
  switch (type) {
    case "bar":
      return <ChartIcon className="h-10 w-10 text-neutral-fg-subtle/40" />;
    case "line":
    case "area":
      return <ChartIcon className="h-10 w-10 text-neutral-fg-subtle/40" />;
    case "point":
    case "scatter":
      return <DataPointIcon className="h-10 w-10 text-neutral-fg-subtle/40" />;
    case "table":
    default:
      return <TableIcon className="h-10 w-10 text-neutral-fg-subtle/40" />;
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
 *   onClick={() => navigate({ to: `/visualizations/${viz.id}` } as never)}
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
        "group w-full overflow-hidden rounded-lg border text-left transition-[border-color,background-color] duration-150",
        onClick && "cursor-pointer hover:bg-neutral-bg-emphasis/50",
        active
          ? "border-palette-primary ring-2 ring-palette-primary"
          : "border-neutral-border/60 hover:border-neutral-border",
        className,
      )}
    >
      {/* Preview Section */}
      <div
        className="w-full overflow-hidden bg-neutral-bg-muted/30"
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
              "min-w-0 flex-1 truncate text-sm font-medium transition-colors",
              active ? "text-palette-primary" : "text-neutral-fg",
            )}
          >
            {visualization.name}
          </p>

          {/* Actions dropdown menu */}
          {hasActions && (
            <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      icon={MoreIcon}
                      iconOnly
                      label="Actions"
                      size="sm"
                      className="text-neutral-fg-subtle hover:text-neutral-fg"
                    />
                  }
                />
                <DropdownMenuContent align="end">
                  {actions.map((action, index) => (
                    <DropdownMenuItem
                      key={index}
                      onClick={action.onClick}
                      className={cn(
                        action.color === "danger" &&
                          "text-palette-danger focus:text-palette-danger",
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
        <p className="mt-1 truncate text-xs text-neutral-fg-subtle">
          Created {createdDate}
        </p>
      </div>
    </div>
  );
}
