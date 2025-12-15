/**
 * @dashframe/core
 *
 * Core package with environment-based backend selection.
 *
 * This package selects the backend implementation based on the
 * NEXT_PUBLIC_DATA_BACKEND environment variable:
 * - "dexie" (default) → @dashframe/core-dexie (IndexedDB)
 * - "convex" → @dashframe/core-convex (Cloud sync)
 *
 * Components import from @dashframe/core and remain backend-agnostic.
 * To switch backends, just change the environment variable and rebuild.
 *
 * @example
 * ```bash
 * # Use Dexie backend (OSS)
 * NEXT_PUBLIC_DATA_BACKEND=dexie pnpm dev
 *
 * # Use Convex backend (Cloud) - Future
 * NEXT_PUBLIC_DATA_BACKEND=convex pnpm dev
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

// ============================================================================
// Backend Info (Debug Helper)
// ============================================================================

/**
 * Get information about the currently active backend.
 * Useful for debugging and feature detection.
 */
export function getBackendInfo() {
  const backend = process.env.NEXT_PUBLIC_DATA_BACKEND || "dexie";
  return {
    backend,
    isCloud: backend === "convex",
    isLocal: backend === "dexie",
  };
}
