/**
 * @dashframe/core
 *
 * Core package.
 *
 * All artifact CRUD is backed by the WyStack server through @dashframe/app-data.
 * Components import hooks and imperative helpers from @dashframe/core.
 */

// ============================================================================
// Backend Implementation Exports
// ============================================================================

export * from "@dashframe/app-data";

// ============================================================================
// Chart Renderer Types (Defined in Core)
// ============================================================================

export type {
  ChartCleanup,
  ChartConfig,
  ChartRenderer,
  ChartRendererRegistry,
  ChartTheme,
} from "./chart-renderers";
