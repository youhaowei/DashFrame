/**
 * Chart Renderers Module
 *
 * The plugin contract for the pluggable chart rendering system.
 *
 * Package-internal: these types reach the outside world through
 * `@dashframe/visualization`'s public barrel, which re-exports them. Import
 * them from the package root, not from this path.
 */

export type {
  ChartCleanup,
  ChartConfig,
  ChartRenderer,
  ChartRendererRegistry,
  ChartTheme,
} from "./types";
