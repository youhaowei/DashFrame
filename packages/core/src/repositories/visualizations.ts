import type { UUID } from "../types";
import type { UseQueryResult } from "./types";

// ============================================================================
// Visualization Types
// ============================================================================

/**
 * Vega-Lite specification type.
 * Using 'unknown' for flexibility - actual type is from vega-lite package.
 */
export type VegaLiteSpec = Record<string, unknown>;

/**
 * Visualization - A chart/graph configuration.
 *
 * Visualizations are linked to Insights and contain:
 * - Vega-Lite specification
 * - UI state (selected, expanded, etc.)
 */
export interface Visualization {
  id: UUID;
  name: string;
  /** Parent insight ID */
  insightId: UUID;
  /** Vega-Lite chart specification */
  spec: VegaLiteSpec;
  /** Whether this is the active visualization */
  isActive?: boolean;
  createdAt: number;
  updatedAt?: number;
}

// ============================================================================
// Repository Hook Types
// ============================================================================

/**
 * Result type for useVisualizations hook.
 */
export type UseVisualizationsResult = UseQueryResult<Visualization[]>;

/**
 * Mutation methods for visualizations.
 */
export interface VisualizationMutations {
  /** Create a new visualization */
  create: (name: string, insightId: UUID, spec: VegaLiteSpec) => Promise<UUID>;

  /** Update a visualization */
  update: (
    id: UUID,
    updates: Partial<Omit<Visualization, "id" | "createdAt" | "insightId">>,
  ) => Promise<void>;

  /** Remove a visualization */
  remove: (id: UUID) => Promise<void>;

  /** Set active visualization */
  setActive: (id: UUID) => Promise<void>;

  /** Update the Vega-Lite spec */
  updateSpec: (id: UUID, spec: VegaLiteSpec) => Promise<void>;
}

/**
 * Hook type for reading visualizations.
 */
export type UseVisualizations = (insightId?: UUID) => UseVisualizationsResult;

/**
 * Hook type for visualization mutations.
 */
export type UseVisualizationMutations = () => VisualizationMutations;
