import { useMutation } from "convex/react";
import { VisualizationDisplay } from "@/components/visualizations/VisualizationDisplay";
import { api } from "@dashframe/convex-backend/api";
import type {
  DashboardControl,
  DashboardItemOverrides,
  DashboardItem as DashboardItemType,
} from "@dashframe/types";
import { cmd, type UUID } from "@dashframe/types";
import { groupHoverAndFocusWithinReveal } from "@dashframe/ui";

import { Button, cn, Surface } from "@wystack/ui-react";
import { DeleteIcon, DragHandleIcon, EditIcon } from "@wystack/ui-react/icons";
import { useState } from "react";
import { toast } from "sonner";
import { MarkdownWidget } from "./MarkdownWidget";
import { OverridePopover } from "./OverridePopover";

interface DashboardItemProps {
  item: DashboardItemType;
  dashboardId: string;
  isEditable: boolean;
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

export function DashboardItem({
  item,
  dashboardId,
  isEditable,
  effectiveOverrides,
  controls = [],
  className,
  style,
  onMouseDown,
  onMouseUp,
  onTouchEnd,
  ...props
}: DashboardItemProps) {
  const [isEditingContent, setIsEditingContent] = useState(false);
  const commitBatch = useMutation(api.app.commitBatch);
  const [isSavingContent, setIsSavingContent] = useState(false);

  const handleRemove = async () => {
    try {
      await commitBatch({
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

  const handleSaveContent = async (content: string) => {
    setIsSavingContent(true);
    try {
      await commitBatch({
        commands: [
          cmd("UpdateDashboardItem", {
            dashboardId: dashboardId as UUID,
            itemId: item.id,
            updates: { content },
          }),
        ],
      });
    } catch {
      // Keep the editor open on failure so the user's text isn't lost.
      toast.error("Couldn't save the widget");
      return;
    } finally {
      setIsSavingContent(false);
    }
    setIsEditingContent(false);
  };

  return (
    <div
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
            {item.type === "markdown" && (
              <Button
                label="Edit content"
                variant="ghost"
                size="sm"
                className="h-6 w-6 hover:bg-neutral-bg/80"
                onClick={() => setIsEditingContent(true)}
              >
                <EditIcon className="h-3.5 w-3.5" />
              </Button>
            )}
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
        className="relative z-10 flex h-full flex-col overflow-hidden"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {item.type === "markdown" ? (
            <MarkdownWidget
              content={item.content || ""}
              isEditing={isEditingContent}
              onSave={handleSaveContent}
              onCancel={() => setIsEditingContent(false)}
              isSaving={isSavingContent}
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

        {/* Customize button + override badge — visualization cells only, editor-mode only.
            Hidden from non-editors: the underlying commitBatch commands persist
            changes, which is not the intended v0.3 viewer scope.
            Visible on hover or focus within, anchored bottom-right inside the surface. */}
        {item.type === "visualization" && isEditable && (
          <div
            className={cn(
              "absolute right-2 bottom-2 z-20 transition-opacity",
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
