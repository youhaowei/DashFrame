import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Whether the assistant is visible. Panel *geometry* (width) is no longer the
 * assistant's concern — it shares the shell's right Dock, whose width lives in
 * the shell store (see RightDock). This store holds only the open/closed state
 * and its ⌘J summon.
 *
 * `pendingDraftId` is a transient draft waiting for user review. It is NOT
 * persisted — a persisted draftId could go stale across server restarts. The
 * pi-agent sets this when it produces a draft; the DraftReviewPanel reads it.
 */
interface AssistantState {
  /** Whether the assistant panel is visible. */
  isOpen: boolean;
  /**
   * A draft the assistant has queued for user review. When non-null the
   * assistant panel shows the DraftReviewPanel instead of the empty state.
   * Set by the pi-agent producer; cleared on publish or discard.
   */
  pendingDraftId: string | null;
}

interface AssistantActions {
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Set (or clear) a draft waiting for review. Opens the panel when non-null. */
  setPendingDraft: (id: string | null) => void;
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
      // Transient — not persisted. A stale draftId across a server restart
      // would surface a "draft not found" error in the review panel.
      pendingDraftId: null,

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setPendingDraft: (id) =>
        set((s) => ({
          pendingDraftId: id,
          // Open the panel automatically when a draft is queued.
          isOpen: id !== null ? true : s.isOpen,
        })),
    }),
    {
      name: "dashframe:assistant",
      storage: createJSONStorage(() => safeLocalStorage),
      skipHydration: true,
      // Persist only last-open state; pendingDraftId is session-only.
      partialize: (s) => ({ isOpen: s.isOpen }),
    },
  ),
);
