import "./config";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UUID } from "@dashframe/core";
import type { DataFrameEntry } from "./dataframes-store";
import type {
  Visualization,
  VisualizationSource,
  VisualizationType,
  VisualizationEncoding,
} from "./types";
import type { TopLevelSpec } from "vega-lite";
import { useDataFramesStore } from "./dataframes-store";
import { superjsonStorage } from "./storage";

// ============================================================================
// State Interface
// ============================================================================

interface VisualizationsState {
  visualizations: Map<UUID, Visualization>;
  _cachedVisualizations: Visualization[]; // Cached array for stable references
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

  // Get resolved visualization (with DataFrame entry metadata)
  // Note: This only returns metadata, not actual data. Use useDataFrameData hook for data.
  getResolved: (
    id: UUID,
  ) => { viz: Visualization; entry: DataFrameEntry } | null;
  getActiveResolved: () => {
    viz: Visualization;
    entry: DataFrameEntry;
  } | null;

  // General
  get: (id: UUID) => Visualization | undefined;
  getAll: () => Visualization[];
  getVisualizationsUsingInsight: (insightId: UUID) => Visualization[];
  clear: () => void;
}

type VisualizationsStore = VisualizationsState & VisualizationsActions;

// ============================================================================
// Migration Logic
// ============================================================================

type PersistedVisualizationsState = Pick<
  VisualizationsState,
  "visualizations" | "activeId"
>;

/**
 * Migrate legacy visualization data to current schema.
 * Handles old visualizations that don't have visualizationType field.
 */
function migrateVisualizationsState(
  state: PersistedVisualizationsState,
): PersistedVisualizationsState {
  // Handle legacy array format from old JSON storage
  if (Array.isArray(state.visualizations)) {
    type LegacyVisualization = Omit<Visualization, "visualizationType"> &
      Partial<Pick<Visualization, "visualizationType">>;

    const visualizations = new Map(
      (state.visualizations as unknown as [UUID, LegacyVisualization][]).map(
        ([id, viz]) => [
          id,
          {
            ...viz,
            // Add default visualizationType if missing (backward compatibility)
            visualizationType: viz.visualizationType || "bar",
          } as Visualization,
        ],
      ),
    );
    return { ...state, visualizations };
  }

  // Handle Map format (superjson) - still need to migrate missing fields
  if (state.visualizations instanceof Map) {
    for (const [id, viz] of state.visualizations.entries()) {
      if (!viz.visualizationType) {
        state.visualizations.set(id, { ...viz, visualizationType: "bar" });
      }
    }
  }

  return state;
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useVisualizationsStore = create<VisualizationsStore>()(
  persist(
    immer((set, get) => ({
      // Initial state
      visualizations: new Map(),
      _cachedVisualizations: [],
      activeId: null,

      // Create visualization
      create: (source, name, spec, visualizationType = "table", encoding) => {
        const id = crypto.randomUUID();
        const now = Date.now();

        // Strip embedded data from spec to avoid localStorage quota issues
        // Data will be loaded from DuckDB when rendering
        const specWithoutData = { ...spec } as Record<string, unknown>;
        if ("data" in specWithoutData) {
          delete specWithoutData.data;
        }

        const visualization: Visualization = {
          id,
          name,
          source,
          spec: specWithoutData as Omit<TopLevelSpec, "data">,
          visualizationType,
          encoding,
          createdAt: now,
        };

        set((state) => {
          state.visualizations.set(id, visualization);
          state._cachedVisualizations = Array.from(
            state.visualizations.values(),
          );
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
        // Strip embedded data from spec to avoid localStorage quota issues
        const specWithoutData = { ...spec } as Record<string, unknown>;
        if ("data" in specWithoutData) {
          delete specWithoutData.data;
        }

        set((state) => {
          const viz = state.visualizations.get(id);
          if (viz) {
            viz.spec = specWithoutData as Omit<TopLevelSpec, "data">;
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
          state._cachedVisualizations = Array.from(
            state.visualizations.values(),
          );
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

      // Get resolved visualization (with DataFrame entry metadata)
      // Note: This only returns metadata, not actual data. Use useDataFrameData hook for data.
      getResolved: (id) => {
        const viz = get().visualizations.get(id);
        if (!viz) return null;

        const entry = useDataFramesStore
          .getState()
          .getEntry(viz.source.dataFrameId);

        if (!entry) return null;

        return { viz, entry };
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

      // Get all visualizations (returns cached array for stable references)
      getAll: () => {
        return get()._cachedVisualizations;
      },

      // Get visualizations using a specific insight
      getVisualizationsUsingInsight: (insightId) => {
        return Array.from(get().visualizations.values()).filter(
          (viz) => viz.source.insightId === insightId,
        );
      },

      // Clear all visualizations
      clear: () => {
        set((state) => {
          state.visualizations.clear();
          state._cachedVisualizations = [];
          state.activeId = null;
        });
      },
    })),
    {
      name: "dashframe:visualizations",
      storage: superjsonStorage,
      partialize: (state) => ({
        visualizations: state.visualizations,
        activeId: state.activeId,
      }),
      version: 1,
      migrate: (persistedState, version) => {
        if (version === 0) {
          return migrateVisualizationsState(
            persistedState as PersistedVisualizationsState,
          );
        }
        return persistedState as PersistedVisualizationsState;
      },
      skipHydration: true,
    },
  ),
);
