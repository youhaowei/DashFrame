import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Shell chrome state: which flanking regions are open. The left nav and the
 * appearance section are toggled from the top bar. Persisted so the layout the
 * user left it in survives a reload.
 */
export const CONTEXT_PANEL_MIN_WIDTH = 280;
export const CONTEXT_PANEL_MAX_WIDTH = 440;
export const CONTEXT_PANEL_DEFAULT_WIDTH = 336;

export const ASSISTANT_RAIL_MIN_WIDTH = 280;
export const ASSISTANT_RAIL_MAX_WIDTH = 640;
export const ASSISTANT_RAIL_DEFAULT_WIDTH = 384;

interface ShellState {
  /** Left navigation visible. */
  leftNavOpen: boolean;
  /** Appearance section visible in the context panel family. */
  contextAppearanceOpen: boolean;
  /** Width of the page-scoped context panel family, in px. */
  contextPanelWidth: number;
  /** Width of the persistent assistant rail, in px. */
  assistantRailWidth: number;
}

interface ShellActions {
  toggleLeftNav: () => void;
  setLeftNavOpen: (open: boolean) => void;
  toggleContextAppearance: () => void;
  setContextAppearanceOpen: (open: boolean) => void;
  setContextPanelWidth: (width: number) => void;
  setAssistantRailWidth: (width: number) => void;
}

function clamp(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, width));
}

/** SSR-safe localStorage that swallows access failures (mirrors assistant-store). */
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
      /* best-effort */
    }
  },
  removeItem: (name: string): void => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(name);
    } catch {
      /* best-effort */
    }
  },
};

export const useShellStore = create<ShellState & ShellActions>()(
  persist(
    (set) => ({
      leftNavOpen: true,
      contextAppearanceOpen: false,
      contextPanelWidth: CONTEXT_PANEL_DEFAULT_WIDTH,
      assistantRailWidth: ASSISTANT_RAIL_DEFAULT_WIDTH,
      toggleLeftNav: () => set((s) => ({ leftNavOpen: !s.leftNavOpen })),
      setLeftNavOpen: (open) => set({ leftNavOpen: open }),
      toggleContextAppearance: () =>
        set((s) => ({ contextAppearanceOpen: !s.contextAppearanceOpen })),
      setContextAppearanceOpen: (open) => set({ contextAppearanceOpen: open }),
      setContextPanelWidth: (width) =>
        set({
          contextPanelWidth: clamp(
            width,
            CONTEXT_PANEL_MIN_WIDTH,
            CONTEXT_PANEL_MAX_WIDTH,
          ),
        }),
      setAssistantRailWidth: (width) =>
        set({
          assistantRailWidth: clamp(
            width,
            ASSISTANT_RAIL_MIN_WIDTH,
            ASSISTANT_RAIL_MAX_WIDTH,
          ),
        }),
    }),
    {
      name: "dashframe:shell",
      storage: createJSONStorage(() => safeLocalStorage),
    },
  ),
);
