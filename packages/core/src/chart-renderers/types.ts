/**
 * Chart Renderer Types
 *
 * Defines the pluggable renderer interface for DashFrame's visualization system.
 * Renderers implement this interface to support different chart types.
 *
 * @example
 * ```typescript
 * const vgplotRenderer: ChartRenderer = {
 *   supportedTypes: ["bar", "line", "area", "scatter"],
 *   render(container, type, config) {
 *     // Build and render chart
 *     return () => { container.innerHTML = ""; };
 *   }
 * };
 * ```
 */

import type { VisualizationEncoding, VisualizationType } from "../repositories";

// ============================================================================
// Chart Theme
// ============================================================================

/**
 * Theme configuration for chart styling.
 * Maps to CSS custom properties for consistent theming.
 */
export interface ChartTheme {
  /** Background color (e.g., from --color-card) */
  backgroundColor?: string;
  /** Text/foreground color (e.g., from --color-foreground) */
  textColor?: string;
  /** Border/grid color (e.g., from --color-border) */
  borderColor?: string;
  /** Primary accent color for data marks */
  accentColor?: string;
  /** Font family for labels */
  fontFamily?: string;
  /** Base font size in pixels */
  fontSize?: number;
}

// ============================================================================
// Chart Configuration
// ============================================================================

/**
 * Configuration passed to chart renderers.
 *
 * Charts receive a DuckDB table name reference rather than inline data,
 * enabling query pushdown for aggregations.
 */
export interface ChartConfig {
  /** DuckDB table name (usually DataFrame ID) */
  tableName: string;

  /** Column encoding mappings (x, y, color, size) */
  encoding: VisualizationEncoding;

  /** Optional theme configuration */
  theme?: ChartTheme;

  /**
   * Chart width.
   * - "container": Responsive, fills container width
   * - number: Fixed width in pixels
   */
  width?: number | "container";

  /**
   * Chart height.
   * - "container": Responsive, fills container height
   * - number: Fixed height in pixels
   */
  height?: number | "container";

  /**
   * Optional preview mode flag.
   * When true, renderer should optimize for thumbnail display:
   * - Disable axes/legends
   * - Reduce padding
   * - Simplify marks
   */
  preview?: boolean;
}

// ============================================================================
// Chart Renderer Interface
// ============================================================================

/**
 * Cleanup function returned by render().
 * Called when the chart unmounts to release resources.
 */
export type ChartCleanup = () => void;

/**
 * Pluggable chart renderer interface.
 *
 * Implement this interface to add support for new chart types.
 * Renderers are registered with the registry and dispatched by Chart.
 *
 * ## Data Flow
 * ```
 * Chart → registry.get(type) → renderer.render() → DOM
 *                                                      → cleanup()
 * ```
 *
 * ## Implementing a Renderer
 *
 * 1. Define supported chart types
 * 2. Implement render() to create visualization in container
 * 3. Return cleanup function for resource release
 *
 * @example
 * ```typescript
 * const myRenderer: ChartRenderer = {
 *   supportedTypes: ["custom-chart"],
 *
 *   render(container, type, config) {
 *     // Create chart DOM
 *     const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
 *     container.appendChild(svg);
 *
 *     // Query data from DuckDB table and render...
 *
 *     return () => {
 *       // Cleanup
 *       container.innerHTML = "";
 *     };
 *   }
 * };
 * ```
 */
export interface ChartRenderer {
  /**
   * Chart types this renderer can handle.
   * Used by the registry to dispatch rendering requests.
   */
  readonly supportedTypes: readonly VisualizationType[];

  /**
   * Render a chart into the container element.
   *
   * @param container - DOM element to render into
   * @param type - Visualization type (must be in supportedTypes)
   * @param config - Chart configuration including table name and encoding
   * @returns Cleanup function to call on unmount
   */
  render(
    container: HTMLElement,
    type: VisualizationType,
    config: ChartConfig,
  ): ChartCleanup;
}

// ============================================================================
// Renderer Registry Types
// ============================================================================

/**
 * Registry for managing chart renderers.
 *
 * The registry maps visualization types to their renderers,
 * enabling the Chart component to dispatch rendering.
 */
export interface ChartRendererRegistry {
  /**
   * Register a renderer for its supported types.
   * Overwrites existing registrations for those types.
   */
  register(renderer: ChartRenderer): void;

  /**
   * Get the renderer for a visualization type.
   * Returns undefined if no renderer is registered.
   */
  get(type: VisualizationType): ChartRenderer | undefined;

  /**
   * Check if a visualization type has a registered renderer.
   */
  has(type: VisualizationType): boolean;

  /**
   * List all registered visualization types.
   */
  getRegisteredTypes(): VisualizationType[];
}
