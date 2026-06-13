import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Whether the assistant is visible. Panel *geometry* (separate vs. overlay,
 * width) is no longer the assistant's concern — it shares the shell's right
 * Dock, whose mode/width live in the shell store (see RightDock). This store
 * holds only the open/closed state and its ⌘J summon.
 */
interface AssistantState {
  /** Whether the assistant panel is visible. */
  isOpen: boolean;
}

interface AssistantActions {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * localStorage that swallows access failures (quota exceeded, Safari private
 * mode, blocked site storage). Persistence is a nice-to-have for a UI
 * preference — it must never let a write failure escape into a click handler
 * and break the assistant controls. SSR-safe: no-ops without `window`.
 */
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
      // Best-effort: drop the write rather than break the UI.
    }
  },
  removeItem: (name: string): void => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Best-effort.
    }
  },
};

/**
 * Assistant open/closed state. Persists so the panel survives a reload in
 * whatever state the user left it.
 *
 * Uses a plain JSON storage rather than the shared superjson adapter: this
 * store holds only primitives (no Map/Set/Date), and the superjson adapter only
 * revives values carrying a `meta` marker — so a plain persisted object reads
 * back un-rehydrated and the state silently resets to default. Plain JSON
 * round-trips correctly here.
 *
 * `skipHydration: true` keeps SSR deterministic — the `StoreHydration` provider
 * rehydrates client-side after mount.
 */
export const useAssistantStore = create<AssistantState & AssistantActions>()(
  persist(
    (set) => ({
      isOpen: false,

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
    }),
    {
      name: "dashframe:assistant",
      storage: createJSONStorage(() => safeLocalStorage),
      skipHydration: true,
      // Persist only last-open state; actions are derived.
      partialize: (s) => ({ isOpen: s.isOpen }),
    },
  ),
);
