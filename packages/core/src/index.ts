/**
 * @dashframe/core
 *
 * Core package.
 *
 * Renderer app-data is now backed by WyStack through @dashframe/app-data.
 * Components continue importing hooks and imperative helpers from
 * @dashframe/core, but the Dexie/core-store backend selector is no longer in
 * the bundle path.
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
