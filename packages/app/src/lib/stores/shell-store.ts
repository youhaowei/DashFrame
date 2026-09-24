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

interface ShellState {
  /** Left navigation visible. */
  leftNavOpen: boolean;
  /** Appearance section visible in the context panel family. */
  contextAppearanceOpen: boolean;
  /** Width of the page-scoped context panel family, in px. */
  contextPanelWidth: number;
  /**
   * Collapsed workbench panes, keyed by the kind of artifact the workbench
   * edits ("insight", "data-source", …). A missing entry means both panes
   * open, so a new artifact type needs no registration here.
   */
  workbenchPanes: Record<string, WorkbenchPaneState>;
  /**
   * Grid or list, keyed by the artifact type a collection page lists
   * ("report", "data-source", …). A missing entry means grid.
   */
  collectionViews: Record<string, CollectionView>;
  /** The shelf in the nav footer shows its items (vs. only its header). */
  shelfOpen: boolean;
}

export type CollectionView = "grid" | "list";

export type WorkbenchPaneSide = "left" | "right";
export type WorkbenchPaneState = Partial<Record<WorkbenchPaneSide, boolean>>;

interface ShellActions {
  toggleLeftNav: () => void;
  setLeftNavOpen: (open: boolean) => void;
  toggleContextAppearance: () => void;
  setContextAppearanceOpen: (open: boolean) => void;
  setContextPanelWidth: (width: number) => void;
  setWorkbenchPaneOpen: (
    artifactType: string,
    side: WorkbenchPaneSide,
    open: boolean,
  ) => void;
  setCollectionView: (artifactType: string, view: CollectionView) => void;
  setShelfOpen: (open: boolean) => void;
}

function clamp(width: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, width));
}

/** SSR-safe localStorage that swallows access failures. */
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
      workbenchPanes: {},
      collectionViews: {},
      shelfOpen: true,
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
      setWorkbenchPaneOpen: (artifactType, side, open) =>
        set((s) => ({
          workbenchPanes: {
            ...s.workbenchPanes,
            [artifactType]: { ...s.workbenchPanes[artifactType], [side]: open },
          },
        })),
      setCollectionView: (artifactType, view) =>
        set((s) => ({
          collectionViews: { ...s.collectionViews, [artifactType]: view },
        })),
      setShelfOpen: (open) => set({ shelfOpen: open }),
    }),
    {
      name: "dashframe:shell",
      storage: createJSONStorage(() => safeLocalStorage),
    },
  ),
);

/**
 * The saved view for an artifact type. Storage is outside our control (older
 * builds, hand edits), so anything but "list" reads as the default grid.
 */
export function useCollectionView(artifactType: string): CollectionView {
  return useShellStore((state) =>
    state.collectionViews[artifactType] === "list" ? "list" : "grid",
  );
}
