/**
 * @dashframe/visualization
 *
 * Pluggable visualization rendering system for DashFrame.
 * Uses Vega-Lite for chart rendering with inline data arrays.
 *
 * ## Architecture
 *
 * ```
 * useChartData(tableName) ──► data[]
 *                                │
 *                                ▼
 * Chart(data, encoding, type) ──► Registry ──► VegaLiteRenderer ──► SVG
 * ```
 */

// ============================================================================
// Provider
// ============================================================================

export {
  VisualizationProvider,
  useVisualization,
  type VisualizationProviderProps,
} from "./VisualizationProvider";

// ============================================================================
// Registry
// ============================================================================

export {
  chartRendererRegistry,
  clearRegistry,
  getRegisteredTypes,
  getRenderer,
  hasRenderer,
  registerRenderer,
  useRegistryVersion,
} from "./registry";

// ============================================================================
// Components
// ============================================================================

export { Chart, type ChartProps } from "./components";

// ============================================================================
// Renderers
// ============================================================================

export { VEGALITE_SUPPORTED_TYPES, createVegaLiteRenderer } from "./renderers";

// ============================================================================
// Re-export Types
// ============================================================================

// Chart renderer types from @dashframe/core
export type {
  ChartCleanup,
  ChartConfig,
  ChartRenderer,
  ChartRendererRegistry,
  ChartTheme,
} from "@dashframe/core";

// Visualization types from @dashframe/types
export type {
  ChartEncoding,
  VisualizationEncoding,
  VisualizationType,
} from "@dashframe/types";
