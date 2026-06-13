import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { useAssistantStore } from "./assistant-store";

/**
 * Shell chrome state: which flanking regions are open. The left nav and the
 * right appearance panel are toggled from the top bar. Persisted so the layout
 * the user left it in survives a reload.
 *
 * Right-dock arbitration: the appearance panel and a *docked* assistant share
 * the single right Dock slot, so they are mutually exclusive — opening one
 * closes the other. A *floating* assistant is an overlay, not in the slot, so
 * it is exempt (the assistant store owns its dock/width/floating preference;
 * this store only arbitrates the shared docked slot).
 */
/** How the shared right panel presents — global across its contents. */
export type RightDockMode = "separate" | "overlay";

export const RIGHT_DOCK_MIN_WIDTH = 280;
export const RIGHT_DOCK_MAX_WIDTH = 640;
export const RIGHT_DOCK_DEFAULT_WIDTH = 384;

function clampRightDockWidth(w: number): number {
  return Math.min(RIGHT_DOCK_MAX_WIDTH, Math.max(RIGHT_DOCK_MIN_WIDTH, w));
}

interface ShellState {
  /** Left navigation visible. */
  leftNavOpen: boolean;
  /** Right appearance (theme) panel visible. */
  rightPanelOpen: boolean;
  /** Presentation of the shared right panel — applies to whatever it holds. */
  rightDockMode: RightDockMode;
  /** Width of the shared right panel, in px. */
  rightDockWidth: number;
}

interface ShellActions {
  toggleLeftNav: () => void;
  setLeftNavOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightDockMode: (mode: RightDockMode) => void;
  toggleRightDockMode: () => void;
  setRightDockWidth: (width: number) => void;
}

/**
 * Evict the assistant from the shared right panel so the appearance panel can
 * take it. One panel, one content — opening appearance always closes assistant.
 */
function evictAssistant() {
  const assistant = useAssistantStore.getState();
  if (assistant.isOpen) assistant.close();
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
      rightPanelOpen: false,
      rightDockMode: "separate",
      rightDockWidth: RIGHT_DOCK_DEFAULT_WIDTH,
      toggleLeftNav: () => set((s) => ({ leftNavOpen: !s.leftNavOpen })),
      setLeftNavOpen: (open) => set({ leftNavOpen: open }),
      toggleRightPanel: () =>
        set((s) => {
          const next = !s.rightPanelOpen;
          if (next) evictAssistant();
          return { rightPanelOpen: next };
        }),
      setRightPanelOpen: (open) => {
        if (open) evictAssistant();
        set({ rightPanelOpen: open });
      },
      setRightDockMode: (mode) => set({ rightDockMode: mode }),
      toggleRightDockMode: () =>
        set((s) => ({
          rightDockMode:
            s.rightDockMode === "separate" ? "overlay" : "separate",
        })),
      setRightDockWidth: (width) =>
        set({ rightDockWidth: clampRightDockWidth(width) }),
    }),
    {
      name: "dashframe:shell",
      storage: createJSONStorage(() => safeLocalStorage),
    },
  ),
);
