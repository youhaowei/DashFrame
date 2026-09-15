import { computeItemOverrides } from "@/lib/dashboards/controls";
import type {
  Dashboard,
  DashboardItemOverrides,
  InsightFilter,
} from "@dashframe/types";
import { cmd } from "@dashframe/types";

import { useCallback, useMemo, useState } from "react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import { toast } from "sonner";
import { DashboardItem } from "./DashboardItem";
import { useReportWrite } from "./report-write";

const ResponsiveGridLayout = WidthProvider(Responsive);
// View and edit share one set of breakpoints so the editor previews exactly
// what readers see: the saved 12-column layout at every desktop width, laid
// out at the frame's width and scaled to fit. Only a phone width stacks.
const BREAKPOINTS = { lg: 480, xxs: 0 };
/** Below this width the report stacks its items and can't be arranged. */
export const REPORT_STACK_BELOW = BREAKPOINTS.lg;
const COLS = { lg: 12, xxs: 2 };

interface DashboardGridProps {
  dashboard: Dashboard;
  isEditable: boolean;
  /**
   * View-local transient values for controls (from the viewer's session).
   * These are layered on top of saved `control.defaultValue` without mutating
   * the saved dashboard.  Absent → use saved defaults only.
   */
  controlTransientValues?: Map<string, InsightFilter["value"]>;
  /** Item open in the report item pane, if any. */
  selectedItemId?: string | null;
  onSelectItem?: (itemId: string) => void;
  /** Visual scale applied around the grid, so drags track the pointer. */
  transformScale?: number;
}

export function DashboardGrid({
  dashboard,
  isEditable,
  controlTransientValues,
  selectedItemId,
  onSelectItem,
  transformScale = 1,
}: DashboardGridProps) {
  const writeReport = useReportWrite();
  const [activeBreakpoint, setActiveBreakpoint] = useState("lg");

  const layouts = useMemo(() => {
    const lgLayout = dashboard.items.map((item) => ({
      i: item.id,
      x: item.x,
      y: item.y,
      w: item.width,
      h: item.height,
      minW: 2,
      minH: 2,
      // Only the selected tile shows a resize handle.
      isResizable: item.id === selectedItemId,
    }));
    // Phone-width canvases stack every item in one column.
    const xxsLayout = lgLayout.map((item) => ({ ...item, x: 0, w: 2 }));
    return { lg: lgLayout, xxs: xxsLayout };
  }, [dashboard.items, selectedItemId]);

  const persistCanonicalLayout = useCallback(
    (currentLayout: Layout[]) => {
      if (!isEditable || activeBreakpoint !== "lg") return;
      const layoutById = new Map(currentLayout.map((item) => [item.i, item]));
      const commands = dashboard.items.flatMap((item) => {
        const layoutItem = layoutById.get(item.id);
        if (!layoutItem) return [];
        if (
          item.x === layoutItem.x &&
          item.y === layoutItem.y &&
          item.width === layoutItem.w &&
          item.height === layoutItem.h
        ) {
          return [];
        }
        return [
          cmd("UpdateDashboardItem", {
            dashboardId: dashboard.id,
            itemId: item.id,
            updates: {
              x: layoutItem.x,
              y: layoutItem.y,
              width: layoutItem.w,
              height: layoutItem.h,
            },
          }),
        ];
      });
      if (commands.length > 0) {
        writeReport({ commands }).catch((error: unknown) => {
          console.error("Failed to save dashboard layout:", error);
          toast.error("Failed to save dashboard layout");
        });
      }
    },
    [activeBreakpoint, writeReport, dashboard.id, dashboard.items, isEditable],
  );

  // Pre-compute effective overrides for every item.  Merges the item's own
  // saved overrides with any active dashboard controls.  Controls that target
  // an item replace the cell's filter for their field (binding = delegation).
  // This is a stable derived value; re-computed whenever controls or transient
  // values change.
  const effectiveOverridesMap = useMemo<
    Map<string, DashboardItemOverrides | undefined>
  >(() => {
    const controls = dashboard.controls ?? [];
    const map = new Map<string, DashboardItemOverrides | undefined>();
    for (const item of dashboard.items) {
      let effective: DashboardItemOverrides | undefined;
      if (controls.length > 0) {
        effective = computeItemOverrides(
          item,
          controls,
          controlTransientValues,
        );
      } else {
        effective = item.overrides;
      }
      map.set(item.id, effective);
    }
    return map;
  }, [dashboard.controls, dashboard.items, controlTransientValues]);

  return (
    <ResponsiveGridLayout
      className="layout"
      layouts={layouts}
      breakpoints={BREAKPOINTS}
      cols={COLS}
      transformScale={transformScale}
      rowHeight={60}
      isDraggable={isEditable && activeBreakpoint === "lg"}
      isResizable={isEditable && activeBreakpoint === "lg"}
      draggableHandle=".grid-drag-handle"
      onBreakpointChange={setActiveBreakpoint}
      onDragStop={persistCanonicalLayout}
      onResizeStop={persistCanonicalLayout}
      margin={[16, 16]}
      resizeHandle={
        isEditable ? (
          // react-grid-layout marks items that can't resize; the stock rule
          // that hides their handle expects its own class name, not ours.
          <div className="absolute right-0 bottom-0 z-50 flex h-5 w-5 cursor-se-resize items-center justify-center text-palette-primary [.react-resizable-hide>&]:hidden">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M20 8C20 14.6274 14.6274 20 8 20"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </div>
        ) : undefined
      }
    >
      {dashboard.items.map((item) => (
        <div key={item.id}>
          <DashboardItem
            item={item}
            dashboardId={dashboard.id}
            isEditable={isEditable}
            isSelected={item.id === selectedItemId}
            onSelect={onSelectItem}
            effectiveOverrides={effectiveOverridesMap.get(item.id)}
            controls={dashboard.controls ?? []}
          />
        </div>
      ))}
    </ResponsiveGridLayout>
  );
}
