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

export { VGPLOT_SUPPORTED_TYPES, createVgplotRenderer } from "./renderers";

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
