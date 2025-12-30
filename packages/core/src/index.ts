/**
 * @dashframe/core
 *
 * Core package with environment-based backend selection.
 *
 * This package selects the backend implementation based on the
 * NEXT_PUBLIC_DATA_BACKEND environment variable:
 * - "dexie" (default) → @dashframe/core-dexie (IndexedDB)
 * - Custom backends can be added by implementing the repository interfaces
 *
 * Components import from @dashframe/core and remain backend-agnostic.
 * To switch backends, just change the environment variable and rebuild.
 *
 * @example
 * ```bash
 * # Use Dexie backend (default)
 * NEXT_PUBLIC_DATA_BACKEND=dexie bun dev
 *
 * # Use custom backend
 * NEXT_PUBLIC_DATA_BACKEND=custom bun dev
 * ```
 */

// ============================================================================
// Backend Implementation Exports
// ============================================================================

// The backend module selects the implementation based on
// NEXT_PUBLIC_DATA_BACKEND environment variable.
// See ./backend.ts for the selection logic.
export * from "./backend";

// ============================================================================
// Chart Renderer Types (Defined in Core)
// ============================================================================

export type {
  ChartTheme,
  ChartConfig,
  ChartCleanup,
  ChartRenderer,
  ChartRendererRegistry,
} from "./chart-renderers";
