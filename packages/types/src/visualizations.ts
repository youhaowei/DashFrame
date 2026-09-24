import type {
  AxisType,
  ChannelTransform,
  EncodingValue,
} from "./encoding-helpers";
import type { UUID } from "./uuid";

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
type ChartTag = "comparison" | "trend" | "correlation" | "distribution";

/**
 * Metadata for a chart type including tags, display name, and usage hints.
 */
interface ChartTypeMetadata {
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
