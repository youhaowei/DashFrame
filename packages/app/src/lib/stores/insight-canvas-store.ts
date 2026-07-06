import type { VisualizationType } from "@dashframe/types";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type InsightCanvasView =
  | { kind: "table" }
  | { kind: "chart"; chartType: VisualizationType }
  | { kind: "visualization"; visualizationId: string };

interface InsightCanvasState {
  activeViewByInsight: Record<string, InsightCanvasView>;
  setActiveView: (insightId: string, view: InsightCanvasView) => void;
  clearActiveView: (insightId: string) => void;
}

const safeLocalStorage = {
  getItem: (name: string): string | null => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Best-effort artifact UI state.
    }
  },
  removeItem: (name: string): void => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Best-effort artifact UI state.
    }
  },
};

export const TABLE_CANVAS_VIEW: InsightCanvasView = { kind: "table" };

export function canvasViewsEqual(
  left: InsightCanvasView,
  right: InsightCanvasView,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "chart" && right.kind === "chart") {
    return left.chartType === right.chartType;
  }
  if (left.kind === "visualization" && right.kind === "visualization") {
    return left.visualizationId === right.visualizationId;
  }
  return true;
}

export function sanitizeInsightCanvasView(
  view: InsightCanvasView | undefined,
  existingVisualizationIds: Set<string>,
): InsightCanvasView {
  if (view?.kind === "visualization") {
    return existingVisualizationIds.has(view.visualizationId)
      ? view
      : TABLE_CANVAS_VIEW;
  }
  return view ?? TABLE_CANVAS_VIEW;
}

export const useInsightCanvasStore = create<InsightCanvasState>()(
  persist(
    (set) => ({
      activeViewByInsight: {},
      setActiveView: (insightId, view) =>
        set((state) => ({
          activeViewByInsight: {
            ...state.activeViewByInsight,
            [insightId]: view,
          },
        })),
      clearActiveView: (insightId) =>
        set((state) => {
          const next = { ...state.activeViewByInsight };
          delete next[insightId];
          return { activeViewByInsight: next };
        }),
    }),
    {
      name: "dashframe:insight-canvas",
      storage: createJSONStorage(() => safeLocalStorage),
      skipHydration: true,
    },
  ),
);
