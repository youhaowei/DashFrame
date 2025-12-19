import type { UUID } from "./uuid";
import type { UseQueryResult } from "./repository-base";

// ============================================================================
// Visualization Types
// ============================================================================

/**
 * Vega-Lite specification type.
 * Using 'unknown' for flexibility - actual type is from vega-lite package.
 */
export type VegaLiteSpec = Record<string, unknown>;

/**
 * Visualization chart types.
 *
 * Note: "table" is not included - tables are displayed in insights, not visualizations.
 * - bar: Vertical bar chart (categorical X, numerical Y)
 * - barHorizontal: Horizontal bar chart (numerical X, categorical Y)
 * - line: Line chart (continuous X, numerical Y)
 * - area: Area chart (continuous X, numerical Y)
 * - scatter: Scatter plot (continuous X, continuous Y)
 */
export type VisualizationType =
  | "bar"
  | "barHorizontal"
  | "line"
  | "scatter"
  | "area";

/**
 * Axis type for chart encoding.
 */
export type AxisType = "quantitative" | "nominal" | "ordinal" | "temporal";

/**
 * Column encoding for chart visualization.
 */
export interface VisualizationEncoding {
  x?: string;
  y?: string;
  xType?: AxisType;
  yType?: AxisType;
  color?: string;
  size?: string;
}

/**
 * Visualization - A chart/graph configuration.
 *
 * Visualizations are linked to Insights and contain a Vega-Lite specification.
 * Active selection is managed in UI state, not persisted.
 */
export interface Visualization {
  id: UUID;
  name: string;
  /** Parent insight ID */
  insightId: UUID;
  /** Chart type (table, bar, line, etc.) */
  visualizationType: VisualizationType;
  /** Column encodings for chart axes and aesthetics */
  encoding?: VisualizationEncoding;
  /** Vega-Lite chart specification */
  spec: VegaLiteSpec;
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
  create: (
    name: string,
    insightId: UUID,
    visualizationType: VisualizationType,
    spec: VegaLiteSpec,
    encoding?: VisualizationEncoding,
  ) => Promise<UUID>;

  /** Update a visualization */
  update: (
    id: UUID,
    updates: Partial<Omit<Visualization, "id" | "createdAt" | "insightId">>,
  ) => Promise<void>;

  /** Remove a visualization */
  remove: (id: UUID) => Promise<void>;

  /** Update the Vega-Lite spec */
  updateSpec: (id: UUID, spec: VegaLiteSpec) => Promise<void>;

  /** Update the column encoding */
  updateEncoding: (id: UUID, encoding: VisualizationEncoding) => Promise<void>;
}

/**
 * Hook type for reading visualizations.
 */
export type UseVisualizations = (insightId?: UUID) => UseVisualizationsResult;

/**
 * Hook type for visualization mutations.
 */
export type UseVisualizationMutations = () => VisualizationMutations;
