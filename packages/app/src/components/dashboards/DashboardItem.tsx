import { VisualizationDisplay } from "@/components/visualizations/VisualizationDisplay";
import {
  type DashboardControl,
  type DashboardItemOverrides,
  type DashboardItem as DashboardItemType,
  cmd,
  type UUID,
} from "@dashframe/types";
import { groupHoverAndFocusWithinReveal } from "@dashframe/ui";

import { Button, cn, Surface } from "@wystack/ui-react";
import { DeleteIcon, DragHandleIcon } from "@wystack/ui-react/icons";
import { toast } from "sonner";
import { MarkdownWidget } from "./MarkdownWidget";
import { OverridePopover } from "./OverridePopover";
import { useReportWrite } from "./report-write";

interface DashboardItemProps {
  item: DashboardItemType;
  dashboardId: string;
  isEditable: boolean;
  /** True when this item is the one open in the report item pane. */
  isSelected?: boolean;
  /** Selects this item for the report item pane. Editor-mode only. */
  onSelect?: (itemId: string) => void;
  /**
   * Effective overrides for this cell, produced by merging the item's saved
   * `overrides` with any active dashboard controls.  When present this
   * replaces `item.overrides` as the override source for `VisualizationDisplay`.
   * When absent, the item's own saved `overrides` are used as before.
   */
  effectiveOverrides?: DashboardItemOverrides;
  /**
   * Dashboard-level controls passed down from DashboardGrid.  Used by the
   * OverridePopover to derive field-bound state and offer bind/unbind affordances.
   */
  controls?: DashboardControl[];
  className?: string;
  // Props passed by react-grid-layout
  style?: React.CSSProperties;
  onMouseDown?: React.MouseEventHandler;
  onMouseUp?: React.MouseEventHandler;
  onTouchEnd?: React.TouchEventHandler;
}

function noop() {}

export function DashboardItem({
  item,
  dashboardId,
  isEditable,
  isSelected = false,
  onSelect,
  effectiveOverrides,
  controls = [],
  className,
  style,
  onMouseDown,
  onMouseUp,
  onTouchEnd,
  ...props
}: DashboardItemProps) {
  const writeReport = useReportWrite();

  const handleRemove = async () => {
    try {
      await writeReport({
        commands: [
          cmd("RemoveDashboardItem", {
            dashboardId: dashboardId as UUID,
            itemId: item.id,
          }),
        ],
      });
    } catch {
      toast.error("Couldn't remove the widget");
    }
  };

  return (
    <div
      data-dashframe-widget-id={item.id}
      className={cn("group relative h-full w-full", className)}
      style={style}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onTouchEnd={onTouchEnd}
      {...props}
    >
      {/* Action header - tucked under the container's rounded corners, visible on hover or focus within */}
      {isEditable && (
        <div
          className={cn(
            "grid-drag-handle absolute -top-8 right-0 left-0 z-0 flex h-12 cursor-move items-center justify-between rounded-t-lg bg-neutral-bg-muted px-2 pt-4 pb-8 transition-all hover:bg-neutral-bg-muted/80",
            groupHoverAndFocusWithinReveal,
          )}
        >
          {/* Drag Handle Indicator */}
          <div className="flex items-center gap-2 text-neutral-fg-subtle/60">
            <DragHandleIcon className="h-4 w-4" />
          </div>

          {/* Actions */}
          <div
            className="flex items-center gap-1"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Button
              label="Remove item"
              variant="ghost"
              size="sm"
              className="h-6 w-6 text-palette-danger hover:bg-palette-danger/10 hover:text-palette-danger"
              onClick={handleRemove}
            >
              <DeleteIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <Surface
        elevation="raised"
        className={cn(
          "relative z-10 flex h-full flex-col overflow-hidden ring-palette-primary transition-shadow duration-150 motion-reduce:transition-none",
          isSelected && "ring-2",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {item.type === "markdown" ? (
            // Text is edited in the report item pane; the cell renders it.
            <MarkdownWidget
              content={item.content || ""}
              isEditing={false}
              onSave={noop}
              onCancel={noop}
            />
          ) : (
            <div className="h-full w-full">
              <VisualizationDisplay
                visualizationId={item.visualizationId}
                overrides={effectiveOverrides ?? item.overrides}
              />
            </div>
          )}
        </div>

        {/* In editor mode the whole cell selects the item for the pane, and
            the chart underneath stays inert so a click never lands on it. */}
        {isEditable && onSelect && (
          <button
            type="button"
            aria-label={
              item.type === "markdown" ? "Select text item" : "Select chart"
            }
            aria-pressed={isSelected}
            onClick={() => onSelect(item.id)}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute inset-0 z-20 cursor-pointer rounded-[inherit] focus-visible:ring-2 focus-visible:ring-palette-primary focus-visible:outline-none focus-visible:ring-inset"
          />
        )}

        {/* Runtime overrides (filters, sort, limit) live on the chart they
            change — editor-mode only, since they persist. Sits above the
            select overlay so it stays reachable. */}
        {item.type === "visualization" && isEditable && (
          <div
            className={cn(
              "absolute right-2 bottom-2 z-30 transition-opacity",
              groupHoverAndFocusWithinReveal,
            )}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <OverridePopover
              item={item}
              dashboardId={dashboardId}
              controls={controls}
            />
          </div>
        )}
      </Surface>
    </div>
  );
}
