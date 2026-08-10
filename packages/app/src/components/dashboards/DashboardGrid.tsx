import { computeItemOverrides } from "@/lib/dashboards/controls";
import { api } from "@/wystack/api";
import type {
  Dashboard,
  DashboardItemOverrides,
  InsightFilter,
} from "@dashframe/types";
import { useMutation } from "@wystack/client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import { toast } from "sonner";
import { DashboardItem } from "./DashboardItem";

const ResponsiveGridLayout = WidthProvider(Responsive);

// Above 960px, a common 6-column chart is about 456px wide and even a minW: 2
// item is about 141px: (960 - 13 * 16) / 12 * 2 + 16. The previous 720px
// floor yielded roughly 101px for that minimum item.
const EDITABLE_GRID_BREAKPOINT = 960;

const DASHBOARD_GRID_BREAKPOINTS = {
  lg: EDITABLE_GRID_BREAKPOINT,
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

const compareGridPosition = (
  left: { id: string; x: number; y: number },
  right: { id: string; x: number; y: number },
) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id);

interface DashboardGridProps {
  dashboard: Dashboard;
  isEditable: boolean;
  /** Receives availability after the grid container has been measured. */
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
  const containerRef = useRef<HTMLDivElement>(null);
  // Destructure the stable `mutateAsync` — the `useMutation` result object is a
  // fresh reference every render, so depending on it would defeat the
  // `onLayoutChange` memoization. `mutateAsync` is referentially stable.
  const { mutateAsync: saveLayout } = useMutation(api.updateDashboardItems);
  // Keep availability unknown until the container itself has been measured.
  // WidthProvider renders Responsive at its 1280px seed before its observer
  // measures the element, and Responsive does not call onWidthChange on mount.
  const [isEditingAvailable, setIsEditingAvailable] = useState<boolean | null>(
    null,
  );

  const handleWidthChange = useCallback(
    (width: number) => {
      // RGL selects a breakpoint only when width is strictly greater than its
      // configured value, so availability must use the same boundary.
      const isAvailable = width > EDITABLE_GRID_BREAKPOINT;
      if (isAvailable === isEditingAvailable) {
        // Report same-breakpoint measurements too. Parent state setters bail
        // out when the capability is unchanged, while consumers can verify
        // that RGL delivered the width event.
        onEditingAvailabilityChange?.(isAvailable);
        return;
      }
      setIsEditingAvailable(isAvailable);
    },
    [isEditingAvailable, onEditingAvailabilityChange],
  );

  useLayoutEffect(() => {
    const width = containerRef.current?.getBoundingClientRect().width ?? 0;
    if (width > 0) {
      setIsEditingAvailable(width > EDITABLE_GRID_BREAKPOINT);
    }
    // RGL's onWidthChange owns subsequent measurements. This direct first
    // measurement covers the case where the real width equals WidthProvider's
    // seed and RGL consequently emits no change event.
  }, []);

  useEffect(() => {
    if (isEditingAvailable !== null) {
      onEditingAvailabilityChange?.(isEditingAvailable);
    }
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

    const fullWidthLayout = (cols: number) =>
      [...lgLayout]
        .sort(
          (left, right) =>
            left.y - right.y ||
            left.x - right.x ||
            left.i.localeCompare(right.i),
        )
        .map((item) => ({ ...item, x: 0, w: cols }));

    return {
      lg: lgLayout,
      md: fullWidthLayout(DASHBOARD_GRID_COLUMNS.md),
      sm: fullWidthLayout(DASHBOARD_GRID_COLUMNS.sm),
      xs: fullWidthLayout(DASHBOARD_GRID_COLUMNS.xs),
      xxs: fullWidthLayout(DASHBOARD_GRID_COLUMNS.xxs),
    };
  }, [dashboard.items]);

  const itemsInReadingOrder = useMemo(
    () => [...dashboard.items].sort(compareGridPosition),
    [dashboard.items],
  );

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
    <div ref={containerRef}>
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={DASHBOARD_GRID_BREAKPOINTS}
        cols={DASHBOARD_GRID_COLUMNS}
        rowHeight={60}
        isDraggable={isEditable && isEditingAvailable === true}
        isResizable={isEditable && isEditingAvailable === true}
        draggableHandle=".grid-drag-handle"
        onWidthChange={handleWidthChange}
        onDragStop={persistCanonicalLayout}
        onResizeStop={persistCanonicalLayout}
        margin={[16, 16]}
        resizeHandle={
          isEditable && isEditingAvailable === true ? (
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
        {itemsInReadingOrder.map((item) => (
          <div key={item.id}>
            <DashboardItem
              item={item}
              dashboardId={dashboard.id}
              isEditable={isEditable && isEditingAvailable === true}
              effectiveOverrides={effectiveOverridesMap.get(item.id)}
              controls={dashboard.controls ?? []}
            />
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
}
