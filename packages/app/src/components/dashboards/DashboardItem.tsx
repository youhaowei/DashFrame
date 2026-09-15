import { VisualizationDisplay } from "@/components/visualizations/VisualizationDisplay";
import {
  type DashboardControl,
  type DashboardItemOverrides,
  type DashboardItem as DashboardItemType,
  cmd,
  type UUID,
} from "@dashframe/types";
import { ButtonPrimitive, cn } from "@wystack/ui-react";
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
      {/* A flat tile on the report page. The chart underneath stays inert in
          the editor, so a click on it only ever selects. */}
      <div
        className={cn(
          "relative flex h-full flex-col overflow-hidden rounded-lg bg-neutral-bg-subtle ring-palette-primary transition-shadow duration-150 motion-reduce:transition-none dark:bg-neutral-bg-muted",
          isSelected && "ring-2",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {item.type === "markdown" ? (
            // Text is edited in the report item pane; the tile renders it.
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
                chrome="tile"
                display={item.display}
                showTileMenu={!isEditable}
              />
            </div>
          )}
        </div>

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

        {/* The selected tile's tools sit inside its top edge, over the
            select overlay: move, runtime overrides (editor-only, since they
            persist), remove. */}
        {isEditable && (
          <div
            inert={!isSelected}
            className={cn(
              "absolute top-1.5 right-1.5 z-30 flex items-center gap-0.5 rounded-md bg-neutral-bg p-0.5 shadow-[var(--shadow-md)] transition-opacity duration-150 motion-reduce:transition-none",
              isSelected ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <span
              role="img"
              aria-label="Drag to move"
              title="Drag to move"
              className="grid-drag-handle flex h-6 w-6 cursor-move items-center justify-center rounded-md text-neutral-fg-subtle hover:bg-neutral-bg-subtle hover:text-neutral-fg"
            >
              <DragHandleIcon className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div
              className="flex items-center gap-0.5"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {item.type === "visualization" && (
                <OverridePopover
                  item={item}
                  dashboardId={dashboardId}
                  controls={controls}
                />
              )}
              <ButtonPrimitive
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove item"
                title="Remove item"
                className="h-6 w-6 text-palette-danger hover:bg-palette-danger/10 hover:text-palette-danger"
                onClick={handleRemove}
              >
                <DeleteIcon className="h-3.5 w-3.5" aria-hidden />
              </ButtonPrimitive>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
