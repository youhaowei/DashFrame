"use client";

import { useMemo, useRef, useCallback } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import type { Dashboard } from "@/lib/types/dashboard";
import { DashboardItem } from "./DashboardItem";
import { useDashboardsStore } from "@/lib/stores/dashboards-store";

const ResponsiveGridLayout = WidthProvider(Responsive);

interface DashboardGridProps {
  dashboard: Dashboard;
  isEditable: boolean;
}

/** Debounce delay in ms for layout changes during drag/resize */
const LAYOUT_DEBOUNCE_MS = 150;

export function DashboardGrid({ dashboard, isEditable }: DashboardGridProps) {
  const updateItem = useDashboardsStore((state) => state.updateItem);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLayoutRef = useRef<any[] | null>(null);

  const layouts = useMemo(() => {
    // Base layout from stored positions (designed for lg: 12 cols)
    const lgLayout = dashboard.items.map((item) => ({
      i: item.id,
      x: item.layout.x,
      y: item.layout.y,
      w: item.layout.w,
      h: item.layout.h,
      minW: item.layout.minW || 2,
      minH: item.layout.minH || 2,
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

    return { lg: lgLayout, md: mdLayout, sm: smLayout, xs: xsLayout, xxs: xxsLayout };
  }, [dashboard.items]);

  /**
   * Persists pending layout changes to the store.
   * Called after debounce delay or on drag/resize stop.
   */
  const flushLayoutChanges = useCallback(() => {
    const currentLayout = pendingLayoutRef.current;
    if (!currentLayout) return;

    currentLayout.forEach((l) => {
      const item = dashboard.items.find((i) => i.id === l.i);
      if (item) {
        // Only update if changed
        if (
          item.layout.x !== l.x ||
          item.layout.y !== l.y ||
          item.layout.w !== l.w ||
          item.layout.h !== l.h
        ) {
          updateItem(dashboard.id, item.id, {
            layout: {
              x: l.x,
              y: l.y,
              w: l.w,
              h: l.h,
              minW: item.layout.minW,
              minH: item.layout.minH,
            },
          });
        }
      }
    });

    pendingLayoutRef.current = null;
  }, [dashboard.id, dashboard.items, updateItem]);

  /**
   * Debounced handler for layout changes during drag/resize.
   * Stores pending changes and schedules a flush after delay.
   */
  const handleLayoutChange = useCallback(
    (currentLayout: any[]) => {
      if (!isEditable) return;

      // Store the latest layout for deferred processing
      pendingLayoutRef.current = currentLayout;

      // Clear existing timer and schedule new flush
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(flushLayoutChanges, LAYOUT_DEBOUNCE_MS);
    },
    [isEditable, flushLayoutChanges],
  );

  /**
   * Immediately flush on drag/resize stop for responsiveness.
   */
  const handleDragStop = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    flushLayoutChanges();
  }, [flushLayoutChanges]);

  return (
    <ResponsiveGridLayout
      className="layout"
      layouts={layouts}
      breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
      cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
      rowHeight={60}
      isDraggable={isEditable}
      isResizable={isEditable}
      draggableHandle=".grid-drag-handle"
      onLayoutChange={handleLayoutChange}
      onDragStop={handleDragStop}
      onResizeStop={handleDragStop}
      margin={[16, 16]}
      resizeHandle={
        isEditable ? (
          <div className="text-muted-foreground/40 hover:text-muted-foreground absolute -bottom-2 -right-2 z-50 flex h-6 w-6 cursor-se-resize items-center justify-center transition-colors">
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
            isEditable={isEditable}
          />
        </div>
      ))}
    </ResponsiveGridLayout>
  );
}
