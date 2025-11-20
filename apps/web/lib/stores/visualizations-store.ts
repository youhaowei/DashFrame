import "./config";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UUID, EnhancedDataFrame } from "@dashframe/dataframe";
import type {
  Visualization,
  VisualizationSource,
  VisualizationType,
  VisualizationEncoding,
} from "./types";
import type { TopLevelSpec } from "vega-lite";
import { useDataFramesStore } from "./dataframes-store";

// ============================================================================
// State Interface
// ============================================================================

interface VisualizationsState {
  visualizations: Map<UUID, Visualization>;
  activeId: UUID | null;
}

interface VisualizationsActions {
  // Create
  create: (
    source: VisualizationSource,
    name: string,
    spec: Omit<TopLevelSpec, "data">,
    visualizationType?: VisualizationType,
    encoding?: VisualizationEncoding,
  ) => UUID;

  // Update
  update: (
    id: UUID,
    updates: Partial<Omit<Visualization, "id" | "createdAt">>,
  ) => void;
  updateSpec: (id: UUID, spec: Omit<TopLevelSpec, "data">) => void;
  updateVisualizationType: (id: UUID, type: VisualizationType) => void;
  updateEncoding: (id: UUID, encoding: VisualizationEncoding) => void;

  // Delete
  remove: (id: UUID) => void;

  // Active visualization
  setActive: (id: UUID | null) => void;
  getActive: () => Visualization | null;

  // Get resolved visualization (with DataFrame)
  getResolved: (
    id: UUID,
  ) => { viz: Visualization; dataFrame: EnhancedDataFrame } | null;
  getActiveResolved: () => {
    viz: Visualization;
    dataFrame: EnhancedDataFrame;
  } | null;

  // General
  get: (id: UUID) => Visualization | undefined;
  getAll: () => Visualization[];
  clear: () => void;
}

type VisualizationsStore = VisualizationsState & VisualizationsActions;

// ============================================================================
// Storage Serialization (for Map support)
// ============================================================================

const storage = createJSONStorage<VisualizationsState>(() => localStorage, {
  reviver: (_key, value: unknown) => {
    // Convert array back to Map during deserialization
    if (
      value &&
      typeof value === "object" &&
      "visualizations" in value &&
      Array.isArray((value as { visualizations: unknown }).visualizations)
    ) {
      // Migrate old visualizations that don't have visualizationType
      type LegacyVisualization = Omit<Visualization, "visualizationType"> &
        Partial<Pick<Visualization, "visualizationType">>;

      const visualizations = new Map(
        (
          value as { visualizations: [UUID, LegacyVisualization][] }
        ).visualizations.map(([id, viz]) => [
          id,
          {
            ...viz,
            // Add default visualizationType if missing (backward compatibility)
            visualizationType: viz.visualizationType || "bar",
            // encoding is optional, so no need to add default
          } as Visualization,
        ]),
      );

      return {
        ...value,
        visualizations,
      };
    }
    return value;
  },
  replacer: (_key, value: unknown) => {
    // Convert Map to array for JSON serialization
    if (value instanceof Map) {
      return Array.from(value.entries());
    }
    return value;
  },
});

// ============================================================================
// Store Implementation
// ============================================================================

export const useVisualizationsStore = create<VisualizationsStore>()(
  persist(
    immer((set, get) => ({
      // Initial state
      visualizations: new Map(),
      activeId: null,

      // Create visualization
      create: (source, name, spec, visualizationType = "table", encoding) => {
        const id = crypto.randomUUID();
        const now = Date.now();

        const visualization: Visualization = {
          id,
          name,
          source,
          spec,
          visualizationType,
          encoding,
          createdAt: now,
        };

        set((state) => {
          state.visualizations.set(id, visualization);
          state.activeId = id; // Auto-select new visualization
        });

        return id;
      },

      // Update visualization
      update: (id, updates) => {
        set((state) => {
          const viz = state.visualizations.get(id);
          if (viz) {
            Object.assign(viz, updates);
          }
        });
      },

      // Update Vega-Lite spec
      updateSpec: (id, spec) => {
        set((state) => {
          const viz = state.visualizations.get(id);
          if (viz) {
            viz.spec = spec;
          }
        });
      },

      // Update visualization type
      updateVisualizationType: (id, type) => {
        set((state) => {
          const viz = state.visualizations.get(id);
          if (viz) {
            viz.visualizationType = type;
          }
        });
      },

      // Update encoding
      updateEncoding: (id, encoding) => {
        set((state) => {
          const viz = state.visualizations.get(id);
          if (viz) {
            viz.encoding = encoding;
          }
        });
      },

      // Remove visualization
      remove: (id) => {
        set((state) => {
          state.visualizations.delete(id);
          // Clear active if it was removed
          if (state.activeId === id) {
            state.activeId = null;
          }
        });
      },

      // Set active visualization
      setActive: (id) => {
        if (id !== null && !get().visualizations.has(id)) {
          console.warn(`Visualization ${id} not found`);
          return;
        }
        set((state) => {
          state.activeId = id;
        });
      },

      // Get active visualization
      getActive: () => {
        const { activeId, visualizations } = get();
        if (!activeId) return null;
        return visualizations.get(activeId) ?? null;
      },

      // Get resolved visualization (with DataFrame)
      getResolved: (id) => {
        const viz = get().visualizations.get(id);
        if (!viz) return null;

        const dataFrame = useDataFramesStore
          .getState()
          .get(viz.source.dataFrameId);

        if (!dataFrame) return null;

        return { viz, dataFrame };
      },

      // Get active resolved visualization
      getActiveResolved: () => {
        const { activeId } = get();
        if (!activeId) return null;
        return get().getResolved(activeId);
      },

      // Get visualization
      get: (id) => {
        return get().visualizations.get(id);
      },

      // Get all visualizations
      getAll: () => {
        return Array.from(get().visualizations.values());
      },

      // Clear all visualizations
      clear: () => {
        set((state) => {
          state.visualizations.clear();
          state.activeId = null;
        });
      },
    })),
    {
      name: "dashframe:visualizations",
      storage,
      partialize: (state) => ({
        visualizations: state.visualizations,
        activeId: state.activeId,
      }),
      skipHydration: true, // Prevent automatic hydration to avoid SSR mismatch
    },
  ),
);
