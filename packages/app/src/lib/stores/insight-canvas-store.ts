import type { VisualizationType } from "@dashframe/types";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type InsightCanvasView =
  | { kind: "table" }
  | { kind: "chart"; chartType: VisualizationType }
  | { kind: "visualization"; visualizationId: string };

interface InsightCanvasState {
  activeViewByInsight: Record<string, InsightCanvasView>;
  draftChartTypeByInsight: Record<string, VisualizationType>;
  setActiveView: (insightId: string, view: InsightCanvasView) => void;
  setDraftChartType: (insightId: string, chartType: VisualizationType) => void;
  clearDraftChartType: (insightId: string) => void;
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

function mergePersistedInsightCanvasState(
  persistedState: unknown,
  currentState: InsightCanvasState,
): InsightCanvasState {
  const persisted =
    typeof persistedState === "object" && persistedState !== null
      ? (persistedState as Partial<InsightCanvasState>)
      : {};
  const activeViewByInsight = persisted.activeViewByInsight ?? {};
  const draftChartTypeByInsight = {
    ...persisted.draftChartTypeByInsight,
  };

  // Before drafts had their own persisted map, an active chart view was the
  // only record of an unsaved draft. Preserve those drafts while hydrating the
  // legacy shape, before selecting Data can replace the active view.
  for (const [insightId, view] of Object.entries(activeViewByInsight)) {
    if (
      view.kind === "chart" &&
      draftChartTypeByInsight[insightId] === undefined
    ) {
      draftChartTypeByInsight[insightId] = view.chartType;
    }
  }

  return {
    ...currentState,
    ...persisted,
    activeViewByInsight,
    draftChartTypeByInsight,
  };
}

export const useInsightCanvasStore = create<InsightCanvasState>()(
  persist(
    (set) => ({
      activeViewByInsight: {},
      draftChartTypeByInsight: {},
      setActiveView: (insightId, view) =>
        set((state) => ({
          activeViewByInsight: {
            ...state.activeViewByInsight,
            [insightId]: view,
          },
        })),
      setDraftChartType: (insightId, chartType) =>
        set((state) => ({
          draftChartTypeByInsight: {
            ...state.draftChartTypeByInsight,
            [insightId]: chartType,
          },
        })),
      clearDraftChartType: (insightId) =>
        set((state) => {
          const next = { ...state.draftChartTypeByInsight };
          delete next[insightId];
          return { draftChartTypeByInsight: next };
        }),
      clearActiveView: (insightId) =>
        set((state) => {
          const activeViews = { ...state.activeViewByInsight };
          const draftChartTypes = { ...state.draftChartTypeByInsight };
          delete activeViews[insightId];
          delete draftChartTypes[insightId];
          return {
            activeViewByInsight: activeViews,
            draftChartTypeByInsight: draftChartTypes,
          };
        }),
    }),
    {
      name: "dashframe:insight-canvas",
      storage: createJSONStorage(() => safeLocalStorage),
      skipHydration: true,
      merge: mergePersistedInsightCanvasState,
    },
  ),
);
