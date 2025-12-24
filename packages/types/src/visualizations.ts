import type { UUID } from "./uuid";
import type { UseQueryResult } from "./repository-base";
import type {
  EncodingValue,
  AxisType,
  ChannelTransform,
} from "./encoding-helpers";

// Re-export AxisType for convenience
export type { AxisType };

// ============================================================================
// Visualization Types
// ============================================================================

/**
 * Vega-Lite specification type.
 * Using 'unknown' for flexibility - actual type is from vega-lite package.
 */
export type VegaLiteSpec = Record<string, unknown>;

/**
 * Maximum number of points for scatter plots before switching to hexbin.
 * Scatter plots with raw dots become unreadable with too many points.
 * Used by:
 * - Chart suggestion logic (suggest hexbin instead of dot for large datasets)
 * - UI components (disable scatter option when dataset exceeds threshold)
 */
export const SCATTER_MAX_POINTS = 5000;

/**
 * Visualization chart types.
 *
 * Names match vgplot API for consistency with the rendering layer.
 *
 * - barY: Vertical bar chart (categorical X, numerical Y) - maps to vgplot.barY()
 * - barX: Horizontal bar chart (numerical X, categorical Y) - maps to vgplot.barX()
 * - line: Line chart (continuous X, numerical Y) - maps to vgplot.lineY()
 * - areaY: Area chart (continuous X, numerical Y) - maps to vgplot.areaY()
 * - dot: Scatter plot (continuous X, continuous Y) - maps to vgplot.dot(), best for <5K points
 * - hexbin: Hexagonal binning (aggregates scatter points into hex cells by density)
 * - heatmap: Density heatmap (smooth color gradient showing point concentration)
 * - raster: Pixel-based aggregation (fastest for very large datasets, 100K+)
 */
export type VisualizationType =
  | "barY"
  | "barX"
  | "line"
  | "areaY"
  | "dot"
  | "hexbin"
  | "heatmap"
  | "raster";

// ============================================================================
// Chart Tag System
// ============================================================================

/**
 * Chart tags categorize chart types by their analytical purpose.
 *
 * Tags are more flexible than rigid categories because a chart type can have
 * multiple tags (e.g., barY can be used for both "comparison" and "trend").
 *
 * Current tags:
 * - comparison: Compare values across categories
 * - trend: Show change over time
 * - correlation: Relationships between 2 numeric variables
 * - distribution: Show data spread/density
 *
 * Future tags (when chart types are added):
 * - proportion: Parts of a whole (pie, donut)
 * - kpi: Single value highlight (scorecard, gauge)
 * - geographic: Location-based (map, choropleth)
 */
export type ChartTag = "comparison" | "trend" | "correlation" | "distribution";

/**
 * Metadata for a chart type including tags, display name, and usage hints.
 */
export interface ChartTypeMetadata {
  /** Tags categorizing this chart type's analytical purpose */
  tags: ChartTag[];
  /** Human-readable name for UI display */
  displayName: string;
  /** Short description of what the chart shows */
  description: string;
  /** Usage hint explaining when to use this chart type */
  hint: string;
}

/**
 * Metadata for all chart types.
 *
 * Each chart type has:
 * - tags: Categories it belongs to (flexible, can have multiple)
 * - displayName: Human-readable name
 * - description: Short description
 * - hint: When to use this chart
 */
export const CHART_TYPE_METADATA: Record<VisualizationType, ChartTypeMetadata> =
  {
    barY: {
      tags: ["comparison", "trend"],
      displayName: "Bar",
      description: "Vertical bars comparing values",
      hint: "Compare values across categories or show trends over time periods",
    },
    barX: {
      tags: ["comparison"],
      displayName: "Horizontal bar",
      description: "Horizontal bars for ranking",
      hint: "Good for long category labels or ranking comparisons",
    },
    line: {
      tags: ["trend"],
      displayName: "Line",
      description: "Connected points showing trends",
      hint: "Show how values change over time with continuous data",
    },
    areaY: {
      tags: ["trend"],
      displayName: "Area",
      description: "Filled area emphasizing volume",
      hint: "Like line charts but emphasizes cumulative totals",
    },
    dot: {
      tags: ["correlation"],
      displayName: "Scatter",
      description: "Individual points showing correlation",
      hint: "Explore relationships between two numeric variables (<5K points)",
    },
    hexbin: {
      tags: ["correlation", "distribution"],
      displayName: "Hexbin",
      description: "Density binning for large datasets",
      hint: "Aggregates points into hex cells by density (5K-100K points)",
    },
    heatmap: {
      tags: ["correlation", "distribution"],
      displayName: "Heatmap",
      description: "Smooth density visualization",
      hint: "Shows continuous density distribution for finding clusters",
    },
    raster: {
      tags: ["correlation"],
      displayName: "Raster",
      description: "Pixel aggregation for huge datasets",
      hint: "Fastest for massive datasets (100K+ points)",
    },
  };

/**
 * Tag metadata with display names and descriptions.
 */
export const CHART_TAG_METADATA: Record<
  ChartTag,
  { displayName: string; description: string }
> = {
  comparison: {
    displayName: "Comparison",
    description: "Compare values across categories",
  },
  trend: {
    displayName: "Trend",
    description: "Show change over time",
  },
  correlation: {
    displayName: "Correlation",
    description: "Explore relationships between variables",
  },
  distribution: {
    displayName: "Distribution",
    description: "Visualize data spread and density",
  },
};

/**
 * Get all chart types that have a specific tag.
 *
 * @param tag - The tag to filter by
 * @returns Array of chart types with that tag
 */
export function getChartTypesForTag(tag: ChartTag): VisualizationType[] {
  return (Object.keys(CHART_TYPE_METADATA) as VisualizationType[]).filter(
    (type) => CHART_TYPE_METADATA[type].tags.includes(tag),
  );
}

/**
 * Get all tags for a specific chart type.
 *
 * @param type - The chart type
 * @returns Array of tags for that chart type
 */
export function getTagsForChartType(type: VisualizationType): ChartTag[] {
  return CHART_TYPE_METADATA[type].tags;
}

/**
 * Get all unique tags that are available (have at least one chart type).
 *
 * @returns Array of available tags
 */
export function getAvailableTags(): ChartTag[] {
  const tags = new Set<ChartTag>();
  for (const meta of Object.values(CHART_TYPE_METADATA)) {
    for (const tag of meta.tags) {
      tags.add(tag);
    }
  }
  return Array.from(tags);
}

/**
 * Column encoding for chart visualization.
 *
 * Encoding values use prefixed string IDs:
 * - `field:<uuid>` for dimension fields
 * - `metric:<uuid>` for metric aggregations
 *
 * This ensures encodings remain stable when renaming metrics/fields.
 *
 * Transforms can be applied to encoding channels to modify the data:
 * - `xTransform` / `yTransform`: Date transforms for temporal fields
 */
export interface VisualizationEncoding {
  x?: EncodingValue;
  y?: EncodingValue;
  xType?: AxisType;
  yType?: AxisType;
  color?: EncodingValue;
  size?: EncodingValue;
  /** Date transform for X-axis (when X is a temporal field) */
  xTransform?: ChannelTransform;
  /** Date transform for Y-axis (when Y is a temporal field) */
  yTransform?: ChannelTransform;
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
