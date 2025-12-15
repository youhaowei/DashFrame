/**
 * @dashframe/visualization
 *
 * Pluggable visualization rendering system for DashFrame.
 *
 * ## Quick Start
 *
 * ```tsx
 * import {
 *   VisualizationProvider,
 *   Chart,
 *   registerRenderer,
 *   createVgplotRenderer,
 *   useVisualization,
 * } from "@dashframe/visualization";
 *
 * // 1. Wrap your app with VisualizationProvider
 * function App({ db }) {
 *   return (
 *     <VisualizationProvider db={db}>
 *       <ChartSetup />
 *       <MyCharts />
 *     </VisualizationProvider>
 *   );
 * }
 *
 * // 2. Register renderers on mount
 * function ChartSetup() {
 *   const { api, isReady } = useVisualization();
 *
 *   useEffect(() => {
 *     if (isReady && api) {
 *       registerRenderer(createVgplotRenderer(api));
 *     }
 *   }, [api, isReady]);
 *
 *   return null;
 * }
 *
 * // 3. Render charts
 * function MyCharts() {
 *   return (
 *     <Chart
 *       tableName="my_table"
 *       visualizationType="bar"
 *       encoding={{ x: "category", y: "value" }}
 *     />
 *   );
 * }
 * ```
 *
 * ## Architecture
 *
 * ```
 * VisualizationProvider (Mosaic coordinator + vgplot API)
 *         │
 *         ▼
 * ChartRenderer Registry (maps types to renderers)
 *         │
 *         ▼
 * Chart (dispatches to renderer)
 *         │
 *    ┌────┴────┐
 *    ▼         ▼
 * VgplotRenderer  CustomRenderer
 * (bar,line,etc)  (sankey,etc)
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
  registerRenderer,
  getRenderer,
  hasRenderer,
  getRegisteredTypes,
  clearRegistry,
  chartRendererRegistry,
} from "./registry";

// ============================================================================
// Components
// ============================================================================

export { Chart, type ChartProps } from "./components";

// ============================================================================
// Renderers
// ============================================================================

export { createVgplotRenderer, VGPLOT_SUPPORTED_TYPES } from "./renderers";

// ============================================================================
// Re-export Types
// ============================================================================

// Chart renderer types from @dashframe/core
export type {
  ChartTheme,
  ChartConfig,
  ChartCleanup,
  ChartRenderer,
  ChartRendererRegistry,
} from "@dashframe/core";

// Visualization types from @dashframe/types
export type {
  VisualizationType,
  VisualizationEncoding,
} from "@dashframe/types";
