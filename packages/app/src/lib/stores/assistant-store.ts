import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * How the assistant sidebar is presented:
 * - `docked` — pinned to the right rail, sharing horizontal space with the
 *   artifact (the default, artifact-stays-primary shape).
 * - `floating` — an undocked overlay panel that hovers over the artifact
 *   without reflowing it (useful on narrow widths or for a quick glance).
 */
export type AssistantDock = "docked" | "floating";

/** Clamp bounds for the docked rail width, in px. */
export const ASSISTANT_MIN_WIDTH = 320;
export const ASSISTANT_MAX_WIDTH = 560;
export const ASSISTANT_DEFAULT_WIDTH = 384;

interface AssistantState {
  /** Whether the assistant panel is visible. */
  isOpen: boolean;
  /** Docked rail vs. floating overlay. Persisted preference. */
  dock: AssistantDock;
  /** Docked rail width in px. Persisted preference. */
  width: number;
}

interface AssistantActions {
  open: () => void;
  close: () => void;
  toggle: () => void;
  setDock: (dock: AssistantDock) => void;
  toggleDock: () => void;
  setWidth: (width: number) => void;
}

function clampWidth(width: number): number {
  return Math.min(ASSISTANT_MAX_WIDTH, Math.max(ASSISTANT_MIN_WIDTH, width));
}

/**
 * Assistant sidebar preferences. The docked/undocked preference and rail width
 * persist locally (plain localStorage JSON); open/closed also persists so the
 * panel survives a reload in whatever state the user left it.
 *
 * Uses a plain JSON storage rather than the shared superjson adapter: this
 * store holds only primitives (no Map/Set/Date), and the superjson adapter only
 * revives values carrying a `meta` marker — so a plain persisted object reads
 * back un-rehydrated and the preferences silently reset to defaults. Plain JSON
 * round-trips correctly here.
 *
 * `skipHydration: true` keeps SSR deterministic — the `StoreHydration` provider
 * rehydrates client-side after mount.
 */
export const useAssistantStore = create<AssistantState & AssistantActions>()(
  persist(
    (set) => ({
      isOpen: false,
      dock: "docked",
      width: ASSISTANT_DEFAULT_WIDTH,

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setDock: (dock) => set({ dock }),
      toggleDock: () =>
        set((s) => ({ dock: s.dock === "docked" ? "floating" : "docked" })),
      setWidth: (width) => set({ width: clampWidth(width) }),
    }),
    {
      name: "dashframe:assistant",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      // Persist only durable preferences + last-open state; actions are derived.
      partialize: (s) => ({ isOpen: s.isOpen, dock: s.dock, width: s.width }),
    },
  ),
);
