import type { InsightFilter, InsightSort } from "@dashframe/types";
import { create } from "zustand";

export interface WebMCPDashboardPageState {
  dashboardId: string;
  transientControlValues: Record<string, InsightFilter["value"]>;
}

export interface WebMCPInsightPageState {
  insightId: string;
  pendingName?: string;
  pendingFilters?: InsightFilter[];
  pendingSorts?: InsightSort[];
}

interface WebMCPPageState {
  dashboard: WebMCPDashboardPageState | null;
  insight: WebMCPInsightPageState | null;
  setDashboard: (dashboard: WebMCPDashboardPageState | null) => void;
  setInsight: (insight: WebMCPInsightPageState | null) => void;
  updateInsight: (
    insightId: string,
    updates: Partial<Omit<WebMCPInsightPageState, "insightId">>,
  ) => void;
  clearInsight: (insightId: string) => void;
}

/**
 * Live, page-owned state that cannot be reconstructed from persisted metadata.
 * WebMCP reads this store so an agent sees the same unsaved controls as the
 * human without moving those view-local values onto the server.
 */
export const useWebMCPPageStore = create<WebMCPPageState>((set) => ({
  dashboard: null,
  insight: null,
  setDashboard: (dashboard) => set({ dashboard }),
  setInsight: (insight) => set({ insight }),
  updateInsight: (insightId, updates) =>
    set((state) =>
      state.insight?.insightId === insightId
        ? { insight: { ...state.insight, ...updates } }
        : state,
    ),
  clearInsight: (insightId) =>
    set((state) =>
      state.insight?.insightId === insightId ? { insight: null } : state,
    ),
}));
