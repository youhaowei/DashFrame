import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UUID } from "@dashframe/dataframe";
import type { Dashboard, DashboardItem } from "@/lib/types/dashboard";

interface DashboardsState {
  dashboards: Map<UUID, Dashboard>;
  activeId: UUID | null;
}

interface DashboardsActions {
  addDashboard: (dashboard: Dashboard) => void;
  updateDashboard: (id: UUID, updates: Partial<Dashboard>) => void;
  removeDashboard: (id: UUID) => void;
  setActiveId: (id: UUID | null) => void;

  addItem: (dashboardId: UUID, item: DashboardItem) => void;
  updateItem: (
    dashboardId: UUID,
    itemId: UUID,
    updates: Partial<DashboardItem>,
  ) => void;
  removeItem: (dashboardId: UUID, itemId: UUID) => void;
}

export const useDashboardsStore = create<DashboardsState & DashboardsActions>()(
  persist(
    immer((set) => ({
      dashboards: new Map(),
      activeId: null,

      addDashboard: (dashboard) =>
        set((state) => {
          state.dashboards.set(dashboard.id, dashboard);
        }),

      updateDashboard: (id, updates) =>
        set((state) => {
          const dashboard = state.dashboards.get(id);
          if (dashboard) {
            Object.assign(dashboard, updates);
            dashboard.updatedAt = Date.now();
          }
        }),

      removeDashboard: (id) =>
        set((state) => {
          state.dashboards.delete(id);
          if (state.activeId === id) {
            state.activeId = null;
          }
        }),

      setActiveId: (id) =>
        set((state) => {
          state.activeId = id;
        }),

      addItem: (dashboardId, item) =>
        set((state) => {
          const dashboard = state.dashboards.get(dashboardId);
          if (dashboard) {
            dashboard.items.push(item);
            dashboard.updatedAt = Date.now();
          }
        }),

      updateItem: (dashboardId, itemId, updates) =>
        set((state) => {
          const dashboard = state.dashboards.get(dashboardId);
          if (dashboard) {
            const item = dashboard.items.find((i) => i.id === itemId);
            if (item) {
              Object.assign(item, updates);
              dashboard.updatedAt = Date.now();
            }
          }
        }),

      removeItem: (dashboardId, itemId) =>
        set((state) => {
          const dashboard = state.dashboards.get(dashboardId);
          if (dashboard) {
            dashboard.items = dashboard.items.filter((i) => i.id !== itemId);
            dashboard.updatedAt = Date.now();
          }
        }),
    })),
    {
      name: "dashframe:dashboards",
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const { state } = JSON.parse(str);
          return {
            state: {
              ...state,
              dashboards: new Map(state.dashboards),
            },
          };
        },
        setItem: (name, value) => {
          const state = {
            ...value.state,
            dashboards: Array.from(value.state.dashboards.entries()),
          };
          try {
            localStorage.setItem(name, JSON.stringify({ state }));
          } catch (e) {
            // Handle QuotaExceededError or other storage errors gracefully
            console.error("Failed to save dashboards to localStorage:", e);
          }
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    },
  ),
);
