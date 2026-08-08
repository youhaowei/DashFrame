import { computeItemOverrides } from "@/lib/dashboards/controls";
import { api } from "@/wystack/api";
import type {
  Dashboard,
  DashboardItemOverrides,
  InsightFilter,
} from "@dashframe/types";
import { useMutation } from "@wystack/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import { toast } from "sonner";
import { DashboardItem } from "./DashboardItem";

const ResponsiveGridLayout = WidthProvider(Responsive);

const DASHBOARD_GRID_BREAKPOINTS = {
  lg: 720,
  md: 600,
  sm: 480,
  xs: 320,
  xxs: 0,
};

const DASHBOARD_GRID_COLUMNS = {
  lg: 12,
  md: 10,
  sm: 6,
  xs: 4,
  xxs: 2,
};

const EDITABLE_BREAKPOINT = "lg";

interface DashboardGridProps {
  dashboard: Dashboard;
  isEditable: boolean;
  /** Receives availability from the grid's own WidthProvider measurement. */
  onEditingAvailabilityChange?: (isAvailable: boolean) => void;
  /**
   * View-local transient values for controls (from the viewer's session).
   * These are layered on top of saved `control.defaultValue` without mutating
   * the saved dashboard.  Absent → use saved defaults only.
   */
  controlTransientValues?: Map<string, InsightFilter["value"]>;
}

export function DashboardGrid({
  dashboard,
  isEditable,
  onEditingAvailabilityChange,
  controlTransientValues,
}: DashboardGridProps) {
  // Destructure the stable `mutateAsync` — the `useMutation` result object is a
  // fresh reference every render, so depending on it would defeat the
  // `onLayoutChange` memoization. `mutateAsync` is referentially stable.
  const { mutateAsync: saveLayout } = useMutation(api.updateDashboardItems);
  const [activeBreakpoint, setActiveBreakpoint] = useState<string | null>(null);
  const isEditingAvailable = activeBreakpoint === EDITABLE_BREAKPOINT;

  useEffect(() => {
    onEditingAvailabilityChange?.(isEditingAvailable);
  }, [isEditingAvailable, onEditingAvailabilityChange]);

  const layouts = useMemo(() => {
    // Base layout from stored positions (designed for lg: 12 cols)
    const lgLayout = dashboard.items.map((item) => ({
      i: item.id,
      x: item.x,
      y: item.y,
      w: item.width,
      h: item.height,
      minW: 2,
      minH: 2,
    }));

    // Scale layouts for smaller breakpoints to prevent overflow
    // md: 10 cols - slight scale down
    const mdLayout = lgLayout.map((item) => ({
      ...item,
      x: Math.min(item.x, 10 - Math.min(item.w, 10)),
      w: Math.min(item.w, 10),
    }));

    // sm: 6 cols - items stack more vertically
    const smLayout = lgLayout.map((item) => ({
      ...item,
      x: 0,
      w: Math.min(item.w, 6),
    }));

    // xs: 4 cols - full width items
    const xsLayout = lgLayout.map((item) => ({
      ...item,
      x: 0,
      w: Math.min(item.w, 4),
    }));

    // xxs: 2 cols - single column stacked layout
    const xxsLayout = lgLayout.map((item) => ({
      ...item,
      x: 0,
      w: 2,
    }));

    return {
      lg: lgLayout,
      md: mdLayout,
      sm: smLayout,
      xs: xsLayout,
      xxs: xxsLayout,
    };
  }, [dashboard.items]);

  const persistCanonicalLayout = useCallback(
    (currentLayout: Layout[]) => {
      if (!isEditable || !isEditingAvailable) return;
      const patches = currentLayout.flatMap((layoutItem) => {
        const item = dashboard.items.find(
          (candidate) => candidate.id === layoutItem.i,
        );
        if (
          !item ||
          (item.x === layoutItem.x &&
            item.y === layoutItem.y &&
            item.width === layoutItem.w &&
            item.height === layoutItem.h)
        ) {
          return [];
        }
        return [
          {
            itemId: item.id,
            updates: {
              x: layoutItem.x,
              y: layoutItem.y,
              width: layoutItem.w,
              height: layoutItem.h,
            },
          },
        ];
      });
      if (patches.length > 0) {
        saveLayout({ dashboardId: dashboard.id, patches }).catch(
          (error: unknown) => {
            console.error("Failed to save dashboard layout:", error);
            toast.error("Failed to save dashboard layout");
          },
        );
      }
    },
    [dashboard.id, dashboard.items, isEditable, isEditingAvailable, saveLayout],
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
      breakpoints={DASHBOARD_GRID_BREAKPOINTS}
      cols={DASHBOARD_GRID_COLUMNS}
      rowHeight={60}
      isDraggable={isEditable && isEditingAvailable}
      isResizable={isEditable && isEditingAvailable}
      draggableHandle=".grid-drag-handle"
      onBreakpointChange={setActiveBreakpoint}
      onDragStop={persistCanonicalLayout}
      onResizeStop={persistCanonicalLayout}
      margin={[16, 16]}
      resizeHandle={
        isEditable && isEditingAvailable ? (
          <div className="absolute -right-2 -bottom-2 z-50 flex h-6 w-6 cursor-se-resize items-center justify-center text-neutral-fg-subtle/40 transition-colors hover:text-neutral-fg-subtle">
            <svg
              width="24"
              height="24"
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
            isEditable={isEditable && isEditingAvailable}
            effectiveOverrides={effectiveOverridesMap.get(item.id)}
            controls={dashboard.controls ?? []}
          />
        </div>
      ))}
    </ResponsiveGridLayout>
  );
}
