/**
 * Chart Renderer Registry
 *
 * Manages registration and lookup of chart renderers by visualization type.
 * This enables a pluggable architecture where new chart types can be added
 * by implementing the ChartRenderer interface and registering.
 *
 * @example
 * ```typescript
 * import { registerRenderer, getRenderer } from "@dashframe/visualization";
 *
 * // Register a custom renderer
 * registerRenderer(mySankeyRenderer);
 *
 * // Get renderer for a type
 * const renderer = getRenderer("sankey");
 * if (renderer) {
 *   const cleanup = renderer.render(container, "sankey", config);
 * }
 * ```
 */

import type {
  ChartRenderer,
  ChartRendererRegistry,
  VisualizationType,
} from "@dashframe/core";

// ============================================================================
// Registry Implementation
// ============================================================================

/**
 * Internal registry map.
 * Maps visualization types to their renderers.
 */
const rendererMap = new Map<VisualizationType, ChartRenderer>();

/**
 * Register a chart renderer for its supported types.
 *
 * Overwrites any existing registrations for those types.
 * A renderer can support multiple types.
 *
 * @param renderer - The renderer to register
 *
 * @example
 * ```typescript
 * const myRenderer: ChartRenderer = {
 *   supportedTypes: ["bar", "line"],
 *   render(container, type, config) {
 *     // ... render logic
 *     return () => container.innerHTML = "";
 *   }
 * };
 *
 * registerRenderer(myRenderer);
 * ```
 */
export function registerRenderer(renderer: ChartRenderer): void {
  for (const type of renderer.supportedTypes) {
    rendererMap.set(type, renderer);
  }
}

/**
 * Get the renderer registered for a visualization type.
 *
 * @param type - The visualization type
 * @returns The registered renderer, or undefined if none
 *
 * @example
 * ```typescript
 * const renderer = getRenderer("bar");
 * if (renderer) {
 *   const cleanup = renderer.render(container, "bar", {
 *     tableName: "my_table",
 *     encoding: { x: "category", y: "value" }
 *   });
 * }
 * ```
 */
export function getRenderer(
  type: VisualizationType,
): ChartRenderer | undefined {
  return rendererMap.get(type);
}

/**
 * Check if a visualization type has a registered renderer.
 *
 * @param type - The visualization type
 * @returns true if a renderer is registered
 */
export function hasRenderer(type: VisualizationType): boolean {
  return rendererMap.has(type);
}

/**
 * Get all registered visualization types.
 *
 * @returns Array of registered types
 */
export function getRegisteredTypes(): VisualizationType[] {
  return Array.from(rendererMap.keys());
}

/**
 * Clear all registered renderers.
 * Useful for testing.
 */
export function clearRegistry(): void {
  rendererMap.clear();
}

// ============================================================================
// Registry Object Export
// ============================================================================

/**
 * Registry object implementing the ChartRendererRegistry interface.
 * Alternative API for those who prefer object-style access.
 */
export const chartRendererRegistry: ChartRendererRegistry = {
  register: registerRenderer,
  get: getRenderer,
  has: hasRenderer,
  getRegisteredTypes,
};
