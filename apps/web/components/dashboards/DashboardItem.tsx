"use client";

import { useState } from "react";
import { cn, Surface } from "@dashframe/ui";
import { Button } from "@dashframe/ui/primitives/button";
import { EditIcon, DragHandleIcon, DeleteIcon } from "@dashframe/ui/icons";
import type { DashboardItem as DashboardItemType } from "@dashframe/types";
import { useDashboardMutations } from "@dashframe/core";
import { MarkdownWidget } from "./MarkdownWidget";
import { VisualizationDisplay } from "@/components/visualizations/VisualizationDisplay";

interface DashboardItemProps {
  item: DashboardItemType;
  dashboardId: string;
  isEditable: boolean;
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
  className,
  style,
  onMouseDown,
  onMouseUp,
  onTouchEnd,
  ...props
}: DashboardItemProps) {
  const [isEditingContent, setIsEditingContent] = useState(false);
  const { updateItem, removeItem } = useDashboardMutations();

  return (
    <div
      className={cn("group relative h-full w-full", className)}
      style={style}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onTouchEnd={onTouchEnd}
      {...props}
    >
      {/* Action header - tucked under the container's rounded corners, visible on hover */}
      {isEditable && (
        <div className="grid-drag-handle bg-muted hover:bg-muted/80 absolute -top-8 left-0 right-0 z-0 flex h-12 cursor-move items-center justify-between rounded-t-lg px-2 pb-8 pt-4 opacity-0 transition-all group-hover:opacity-100">
          {/* Drag Handle Indicator */}
          <div className="text-muted-foreground/60 flex items-center gap-2">
            <DragHandleIcon className="h-4 w-4" />
          </div>

          {/* Actions */}
          <div
            className="flex items-center gap-1"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {item.type === "markdown" && (
              <Button
                variant="text"
                size="icon"
                className="hover:bg-background/80 h-6 w-6"
                onClick={() => setIsEditingContent(true)}
              >
                <EditIcon className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="text"
              size="icon"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive h-6 w-6"
              onClick={() => removeItem(dashboardId, item.id)}
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
              onSave={(content) => {
                updateItem(dashboardId, item.id, { content });
                setIsEditingContent(false);
              }}
              onCancel={() => setIsEditingContent(false)}
            />
          ) : (
            <div className="h-full w-full">
              <VisualizationDisplay visualizationId={item.visualizationId} />
            </div>
          )}
        </div>
      </Surface>
    </div>
  );
}
