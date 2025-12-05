"use client";

import { useMemo } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Dashboard } from "@/lib/types/dashboard";
import { DashboardItem } from "./DashboardItem";
import { useDashboardsStore } from "@/lib/stores/dashboards-store";

const ResponsiveGridLayout = WidthProvider(Responsive);

interface DashboardGridProps {
  dashboard: Dashboard;
  isEditable: boolean;
}

export function DashboardGrid({ dashboard, isEditable }: DashboardGridProps) {
  const updateItem = useDashboardsStore((state) => state.updateItem);

  const layouts = useMemo(() => {
    const layout = dashboard.items.map((item) => ({
      i: item.id,
      x: item.layout.x,
      y: item.layout.y,
      w: item.layout.w,
      h: item.layout.h,
      minW: item.layout.minW || 2,
      minH: item.layout.minH || 2,
    }));
    return { lg: layout, md: layout, sm: layout };
  }, [dashboard.items]);

  const handleLayoutChange = (currentLayout: any[]) => {
    if (!isEditable) return;

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
  };

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
